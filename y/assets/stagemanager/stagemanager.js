import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, doc, getDoc, collection, getDocs, query, where, orderBy, onSnapshot, updateDoc, deleteField } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut, getRedirectResult } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { firebaseConfig } from "../core/firebase-config.js";

// Config imported above

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let currentUser = null;
let googleAccessToken = null; // Store for YouTube uploads
let assignedStage = "";
let systemYear = "2025-26";
let currentParticipants = [];
let currentProgramName = "";
let currentProgramId = null;
let currentParticipantId = null;
let currentStudentName = "";
let swapSourceId = null; // To track participant being swapped

// Recording State
let mediaRecorder = null;
let recordedChunks = [];
let stream = null;
let activeUploads = new Map(); // Track background uploads: participantId -> task

// Listen for system year
const yearRef = doc(db, "system_config", "current_year");
onSnapshot(yearRef, (docSnap) => {
    if (docSnap.exists()) {
        systemYear = docSnap.data().year || "2025-26";
        if (currentUser) fetchSchedule(); // Refresh if year changes
    }
});

const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const loginMsg = document.getElementById('login-msg');
const loading = document.getElementById('loading');

function toggleLoading(show) {
    if (show) loading.classList.remove('hidden');
    else loading.classList.add('hidden');
}

window.reAuthorizeYouTube = async () => {
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/youtube.upload');
    // Force the user to select an account and grant permissions properly
    provider.setCustomParameters({ prompt: 'select_account' });

    try {
        toggleLoading(true);
        const result = await signInWithPopup(auth, provider);
        const credential = GoogleAuthProvider.credentialFromResult(result);

        if (credential && credential.accessToken) {
            googleAccessToken = credential.accessToken;
            sessionStorage.setItem('yt_token', googleAccessToken);
            log(`YouTube re-authorization successful. Token refreshed (Length: ${googleAccessToken.length}, Prefix: ${googleAccessToken.substring(0, 5)}...)`);
            return true;
        } else {
            throw new Error("No YouTube access token received from Google.");
        }
    } catch (error) {
        console.error("Re-authorization failed", error);
        alert("Authorization failed: " + error.message);
        return false;
    } finally {
        toggleLoading(false);
    }
};

document.getElementById('google-login-btn').onclick = window.reAuthorizeYouTube;

document.getElementById('logout-btn').onclick = () => {
    if (confirm("Logout?")) signOut(auth);
};

onAuthStateChanged(auth, async (user) => {
    if (user) {
        // Retrieve token if available
        googleAccessToken = sessionStorage.getItem('yt_token');

        toggleLoading(true);
        try {
            // 1. Check Whitelist
            const email = user.email.toLowerCase();
            const yearScopedId = `${email}_${systemYear}`;

            // Optimization: Query by email and year to be sure
            const q = query(
                collection(db, "whitelisted_emails"),
                where("email", "==", email),
                where("academicYear", "==", systemYear)
            );

            const snapshot = await getDocs(q);

            if (snapshot.empty) {
                throw new Error("Access Denied: You are not authorized for this academic year.");
            }

            const userDoc = snapshot.docs[0].data();

            // 2. Check Role
            if (userDoc.role !== 'Stage Manager' && userDoc.role !== 'Main Admin') {
                throw new Error("Access Denied: This portal is for Stage Managers only.");
            }

            // 3. Get Assigned Stage
            assignedStage = userDoc.assignedStage || "Unassigned";
            if (userDoc.role === 'Main Admin' && !userDoc.assignedStage) {
                assignedStage = "All Stages (Admin View)";
            }

            currentUser = user;
            const userName = userDoc.name || user.displayName || user.email.split('@')[0];
            document.getElementById('user-display').textContent = userName;
            document.getElementById('stage-name-display').textContent = assignedStage;


            // Show Dashboard
            loginView.classList.add('hidden');
            dashboardView.classList.remove('hidden');

            fetchSchedule();

        } catch (error) {
            console.error(error);
            loginMsg.innerHTML = `<span style="color: var(--error)">${error.message}</span>`;
            await signOut(auth); // Auto logout if unauthorized
        } finally {
            toggleLoading(false);
        }
    } else {
        loginView.classList.remove('hidden');
        dashboardView.classList.add('hidden');
        currentUser = null;
    }
});

window.fetchSchedule = async () => {
    if (!currentUser || !assignedStage) return;
    const listContainer = document.getElementById('schedule-list');
    listContainer.innerHTML = '<div style="text-align:center; padding: 2rem;"><i class="fas fa-spinner fa-spin"></i> Loading schedule...</div>';

    try {
        let q;
        if (assignedStage === "All Stages (Admin View)") {
            q = query(collection(db, "program_dates"), where("academicYear", "==", systemYear), orderBy("date"));
        } else {
            q = query(
                collection(db, "program_dates"),
                where("academicYear", "==", systemYear),
                where("stage", "==", assignedStage)
            );
        }

        // Use onSnapshot for real-time updates
        onSnapshot(q, (snapshot) => {
            const programs = [];
            const seenPrograms = new Set();

            snapshot.forEach(doc => {
                const data = doc.data();
                programs.push({ id: doc.id, ...data });
            });

            // Split and Sort by date/time
            programs.sort((a, b) => {
                const dateA = new Date(a.date.replace(',', ', ' + new Date().getFullYear()));
                const dateB = new Date(b.date.replace(',', ', ' + new Date().getFullYear()));
                return dateA - dateB;
            });

            listContainer.innerHTML = '';

            if (programs.length === 0) {
                listContainer.innerHTML = '<div class="empty-state">No programs scheduled for this stage yet.</div>';
                return;
            }

            programs.forEach((prog) => {
                let displayName = prog.programName;
                if (!displayName || displayName === 'undefined') {
                    if (prog.id) {
                        const parts = prog.id.split('_');
                        if (parts.length > 1) {
                            const yearPart = parts[parts.length - 1];
                            if (yearPart.includes('-') || yearPart.startsWith('20')) {
                                parts.pop();
                            }
                            displayName = parts.join(' ');
                        } else {
                            displayName = prog.id.replace(/_/g, ' ');
                        }
                    } else {
                        displayName = "Unnamed Program";
                    }
                }

                const uniqueKey = `${displayName}|${prog.date}`;
                if (seenPrograms.has(uniqueKey)) return;
                seenPrograms.add(uniqueKey);

                const el = document.createElement('div');
                el.className = `program-card ${prog.status === 'live' ? 'status-live' : prog.status === 'completed' ? 'status-completed' : ''}`;

                const isLive = prog.status === 'live';
                const isCompleted = prog.status === 'completed';

                el.innerHTML = `
                    <div class="program-time">
                        ${prog.date ? prog.date.split(',')[1] : 'TBD'}
                        ${isLive ? '<div class="live-indicator-pulse">LIVE</div>' : ''}
                    </div>
                    <div class="program-details" onclick="window.openParticipantModal('${displayName}', '${prog.id}')">
                        <div class="program-name">
                            ${displayName}
                        </div>
                        <div style="font-size: 0.8rem; color: #94a3b8;">${prog.date ? prog.date.split(',')[0] : ''}</div>
                         ${assignedStage.includes('Admin') ? `<div style="font-size: 0.75rem; color: var(--accent-primary);">Stage: ${prog.stage}</div>` : ''}
                    </div>
                    <div class="program-actions" style="display: flex; gap: 8px;">
                         ${!isCompleted ? `
                            <button onclick="window.toggleProgramStatus('${prog.id}', '${isLive ? 'upcoming' : 'live'}')" class="status-btn ${isLive ? 'btn-stop' : 'btn-live'}" title="${isLive ? 'Stop Live' : 'Go Live'}">
                                <i class="fas ${isLive ? 'fa-stop-circle' : 'fa-play-circle'}"></i>
                            </button>
                            <button onclick="window.toggleProgramStatus('${prog.id}', 'completed')" class="status-btn btn-complete" title="Record as Completed">
                                <i class="fas fa-check-double"></i>
                            </button>
                         ` : `
                            <div class="completed-badge"><i class="fas fa-check-circle"></i> Done</div>
                         `}
                    </div>
                `;
                listContainer.appendChild(el);
            });
        }, (error) => {
            console.error("Error fetching schedule:", error);
            listContainer.innerHTML = `<div style="text-align:center; color: var(--error);">Error loading schedule: ${error.message}</div>`;
        });

    } catch (error) {
        console.error("Global fetch schedule error:", error);
    }
};

window.toggleProgramStatus = async (programId, newStatus) => {
    try {
        toggleLoading(true);
        const docRef = doc(db, "program_dates", programId);
        await updateDoc(docRef, { status: newStatus });
        log(`Program ${programId} status updated to ${newStatus}`);
    } catch (error) {
        alert("Failed to update status: " + error.message);
    } finally {
        toggleLoading(false);
    }
};

currentProgramId = null;
window.openParticipantModal = async (programName, programId) => {
    const modal = document.getElementById('participant-modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');
    const modalActions = document.getElementById('modal-actions');
    const modalSubtitle = document.getElementById('modal-subtitle');

    currentProgramName = programName;
    currentProgramId = programId;
    modalTitle.textContent = programName;
    modal.classList.remove('hidden');
    modalActions.classList.add('hidden');
    modalBody.innerHTML = '<div style="text-align:center; padding: 2rem; color: var(--text-muted);"><i class="fas fa-spinner fa-spin"></i> Loading participants...</div>';

    try {
        const q = query(
            collection(db, "registrations"),
            where("program", "==", programName),
            where("academicYear", "==", systemYear)
        );

        const snapshot = await getDocs(q);
        currentParticipants = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (!data.isCanceled) { // Exclude canceled
                currentParticipants.push({ id: doc.id, ...data });
            }
        });

        modalSubtitle.innerHTML = `
            <div class="pro-subtitle-row" style="display: flex; align-items: center; gap: 8px;">
                <span>${currentParticipants.length} Participants</span>
                <span style="color: var(--glass-border);">|</span>
                <span style="color: var(--success); font-weight: 600;"><i class="fas fa-shield-halved" style="font-size: 0.7rem;"></i> Stage Responsibility: ${assignedStage}</span>
            </div>
        `;

        // Sort: 1. Chance Number (Performance Order) 
        //       2. Chest Number (Registration Order)
        //       3. Student Name
        currentParticipants.sort((a, b) => {
            const chanceA = parseInt(a.chanceNumber) || 9999;
            const chanceB = parseInt(b.chanceNumber) || 9999;
            if (chanceA !== chanceB) return chanceA - chanceB;

            const chestA = parseInt(a.chestNumber || a.chessNumber) || 9999;
            const chestB = parseInt(b.chestNumber || b.chessNumber) || 9999;
            if (chestA !== chestB) return chestA - chestB;

            return a.studentName.localeCompare(b.studentName);
        });

        if (currentParticipants.length === 0) {
            modalBody.innerHTML = '<div style="text-align:center; padding: 2rem; color: var(--text-muted);">No participants found.</div>';
            return;
        }

        modalActions.classList.remove('hidden');
        renderParticipantsList();

    } catch (error) {
        console.error("Error fetching participants:", error);
        modalBody.innerHTML = `<div style="text-align:center; color: var(--error);">Error loading participants: ${error.message}</div>`;
    }
};

function renderParticipantsList() {
    const modalBody = document.getElementById('modal-body');
    let html = '';

    currentParticipants.forEach(p => {
        const chanceDisplay = p.chanceNumber ? `#${p.chanceNumber}` : '<i class="fas fa-dice"></i>';
        const isSwapSource = swapSourceId === p.id;

        html += `
            <div class="participant-item ${isSwapSource ? 'swapping' : ''}">
                <div class="chance-number clickable" onclick="window.drawLot('${p.id}')" title="Draw Chance">
                    ${chanceDisplay}
                </div>
                <div class="participant-name">
                    <div style="font-size: 1.05rem; font-weight: 600;">${p.studentName}</div>
                    <div style="font-size: 0.8rem; color: var(--text-muted); display: flex; align-items: center; gap: 8px; margin-top: 2px; flex-wrap: wrap;">
                        <span>${p.department || ''}</span>
                        <span style="color: var(--glass-border);">|</span>
                        <span style="color: var(--accent-primary); font-weight: 600;">Chest: ${p.chestNumber || p.chessNumber || 'N/A'}</span>
                    </div>
                </div>
                <div class="participant-actions">
                    ${(activeUploads.has(p.id) && !activeUploads.get(p.id).completed) ?
                `<div class="uploading-pill"><i class="fas fa-plane fa-spin"></i> Uploading...</div>` : ''
            }
                    ${(p.videoUrl || (activeUploads.has(p.id) && activeUploads.get(p.id).completed)) ?
                `
                         <a href="${p.videoUrl || activeUploads.get(p.id).videoUrl}" target="_blank" class="status-btn" title="View Recording" style="background: rgba(16, 185, 129, 0.1); color: var(--success); text-decoration: none;">
                            <i class="fas fa-play"></i>
                         </a>
                         <button onclick="window.deleteVideo('${p.id}', '${p.youtubeId || (activeUploads.has(p.id) ? activeUploads.get(p.id).youtubeId : '')}')" class="status-btn" title="Delete Recording" style="background: rgba(239, 68, 68, 0.1); color: #ef4444;">
                            <i class="fas fa-trash-alt"></i>
                         </button>
                        ` : ''
            }
                    <button onclick="window.openRecordingModal('${p.id}', '${p.studentName.replace(/'/g, "\\'")}')" class="status-btn" title="Record Performance">
                        <i class="fas fa-video"></i>
                    </button>
                    ${p.chanceNumber ?
                `<button onclick="window.initiateSwap('${p.id}')" class="swap-btn" title="Swap Position">
                            <i class="fas fa-exchange-alt"></i>
                         </button>` : ''
            }
                    ${swapSourceId && swapSourceId !== p.id ?
                `<button onclick="window.completeSwap('${p.id}')" class="swap-here-btn">
                            <i class="fas fa-check"></i> Swap Here
                         </button>` : ''
            }
                </div>
            </div>
        `;
    });
    modalBody.innerHTML = html;
}

window.initiateSwap = (participantId) => {
    if (swapSourceId === participantId) {
        swapSourceId = null; // Toggle off
    } else {
        swapSourceId = participantId;
    }
    renderParticipantsList();
};

window.completeSwap = async (targetId) => {
    if (!swapSourceId) return;

    try {
        toggleLoading(true);
        const sourceId = swapSourceId;
        const sourceP = currentParticipants.find(p => p.id === sourceId);
        const targetP = currentParticipants.find(p => p.id === targetId);

        if (!sourceP || !targetP) return;

        const sourceNum = sourceP.chanceNumber;
        const targetNum = targetP.chanceNumber; // Could be undefined

        const sourceRef = doc(db, "registrations", sourceId);
        const targetRef = doc(db, "registrations", targetId);

        // Update target first
        if (sourceNum) {
            await updateDoc(targetRef, { chanceNumber: sourceNum });
        } else {
            await updateDoc(targetRef, { chanceNumber: deleteField() });
        }

        // Update source
        if (targetNum) {
            await updateDoc(sourceRef, { chanceNumber: targetNum });
        } else {
            await updateDoc(sourceRef, { chanceNumber: deleteField() });
        }

        swapSourceId = null;
        await window.openParticipantModal(currentProgramName);
    } catch (error) {
        alert("Swap failed: " + error.message);
    } finally {
        toggleLoading(false);
    }
};

window.drawLot = (participantId) => {
    const modal = document.getElementById('lottery-modal');
    const grid = document.getElementById('lottery-grid');
    modal.classList.remove('hidden');

    const total = currentParticipants.length;
    const used = currentParticipants.map(p => parseInt(p.chanceNumber)).filter(n => !isNaN(n));

    // Available numbers
    const available = [];
    for (let i = 1; i <= total; i++) {
        if (!used.includes(i)) available.push(i);
    }

    if (available.length === 0) {
        grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 1rem;">No chances left to roll!</div>';
        return;
    }

    grid.innerHTML = `
        <div class="dice-container">
            <div id="dice" class="dice" onclick="window.rollDice('${participantId}', ${JSON.stringify(available)})">
                <i class="fas fa-dice"></i>
                <div class="dice-label">TAP TO ROLL</div>
            </div>
        </div>
        <div class="taken-info">
            Already taken: ${used.length > 0 ? used.join(', ') : 'None'}
        </div>
    `;
};

window.rollDice = (participantId, available) => {
    const dice = document.getElementById('dice');
    if (dice.classList.contains('rolling')) return;

    dice.classList.add('rolling');

    let rollCount = 0;
    const maxRolls = 20;
    const interval = 80;

    const rollEffect = setInterval(() => {
        const randomIndex = Math.floor(Math.random() * available.length);
        const tempValue = available[randomIndex];
        dice.innerHTML = `<span class="roll-value">${tempValue}</span>`;

        rollCount++;
        if (rollCount >= maxRolls) {
            clearInterval(rollEffect);
            const finalValue = available[Math.floor(Math.random() * available.length)];
            dice.innerHTML = `<span class="final-value">${finalValue}</span>`;
            dice.classList.add('landed');

            setTimeout(() => {
                dice.classList.remove('rolling', 'landed');
                window.assignLot(participantId, finalValue);
            }, 1000);
        }
    }, interval);
};

window.assignLot = async (participantId, number) => {
    try {
        toggleLoading(true);
        const docRef = doc(db, "registrations", participantId);
        await updateDoc(docRef, { chanceNumber: number.toString() });

        // Update local state and re-render
        currentParticipants = currentParticipants.map(p =>
            p.id === participantId ? { ...p, chanceNumber: number.toString() } : p
        );

        // Resort
        currentParticipants.sort((a, b) => {
            const chanceA = parseInt(a.chanceNumber) || 9999;
            const chanceB = parseInt(b.chanceNumber) || 9999;
            if (chanceA !== chanceB) return chanceA - chanceB;

            const chestA = parseInt(a.chestNumber || a.chessNumber) || 9999;
            const chestB = parseInt(b.chestNumber || b.chessNumber) || 9999;
            if (chestA !== chestB) return chestA - chestB;

            return a.studentName.localeCompare(b.studentName);
        });

        renderParticipantsList();
        closeLotteryModal();
    } catch (error) {
        alert("Failed to assign number: " + error.message);
    } finally {
        toggleLoading(false);
    }
};

// Removed randomizeAllLots per user request

window.clearAllLots = async () => {
    if (!confirm("Clear all chance numbers for this program? This will reset the order.")) return;

    try {
        toggleLoading(true);
        const promises = currentParticipants.map(p => {
            const docRef = doc(db, "registrations", p.id);
            return updateDoc(docRef, { chanceNumber: deleteField() });
        });

        await Promise.all(promises);
        await window.openParticipantModal(currentProgramName);
    } catch (error) {
        alert("Clear failed: " + error.message);
    } finally {
        toggleLoading(false);
    }
};

window.closeLotteryModal = () => {
    document.getElementById('lottery-modal').classList.add('hidden');
};

// --- Video Recording Logic ---

window.openRecordingModal = async (participantId, studentName) => {
    // 1. Check for YouTube Access Token BEFORE showing modal or accessing camera
    googleAccessToken = sessionStorage.getItem('yt_token');

    if (!googleAccessToken) {
        const proceed = confirm("YouTube access token missing. You need to authorize your account to enable video uploads after recording. Authorize now?");
        if (proceed) {
            const success = await window.reAuthorizeYouTube();
            if (!success) {
                log("Recording aborted: YouTube authorization failed or cancelled.");
                return; // Stop if they didn't authorize
            }
            // reAuthorizeYouTube sets googleAccessToken and sessionStorage on success
        } else {
            return; // Stop if they chose not to authorize
        }
    }

    currentParticipantId = participantId;
    currentStudentName = studentName;
    const modal = document.getElementById('recording-modal');
    const title = document.getElementById('recording-modal-title');
    const subtitle = document.getElementById('recording-modal-subtitle');
    const preview = document.getElementById('recording-preview');

    title.textContent = studentName;
    subtitle.innerHTML = `<i class="fas fa-microphone-lines" style="color: var(--accent-primary); margin-right: 5px;"></i> Recording Program: <span style="color: #fff; font-weight: 600;">${currentProgramName}</span>`;

    modal.classList.remove('hidden');

    // Reset buttons for Pro UI
    document.getElementById('start-record-btn').classList.remove('hidden');
    document.getElementById('stop-record-btn').classList.add('hidden');
    document.getElementById('post-record-actions').classList.add('hidden');
    document.getElementById('save-section').classList.add('hidden');
    document.getElementById('upload-status').classList.add('hidden');
    document.getElementById('shutter-label').textContent = 'Record';
    document.getElementById('recording-preview').controls = false;

    try {
        // Default to environment (back) camera
        // If already set (during a switch), use that. Otherwise 'environment'.
        if (!window.currentFacingMode) window.currentFacingMode = 'environment';

        await window.startCameraStream();
    } catch (err) {
        console.error("Camera error:", err);
        alert("Could not access camera/microphone. Please check permissions.");
        closeRecordingModal();
    }
};

window.startCameraStream = async () => {
    const preview = document.getElementById('recording-preview');

    // Stop existing stream if any
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }

    const constraints = {
        video: {
            facingMode: { ideal: window.currentFacingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 }
        },
        audio: true
    };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    preview.srcObject = stream;
    preview.muted = true;
};

window.switchCamera = async () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        alert("Cannot switch camera while recording!");
        return;
    }

    window.currentFacingMode = window.currentFacingMode === 'user' ? 'environment' : 'user';

    // Add rotation animation to button
    const btnIcon = document.querySelector('#switch-camera-btn i');
    if (btnIcon) btnIcon.classList.add('fa-spin');

    try {
        await window.startCameraStream();
    } catch (error) {
        console.error("Switch camera failed:", error);
        alert("Failed to switch camera: " + error.message);
        // Revert mode if failed
        window.currentFacingMode = window.currentFacingMode === 'user' ? 'environment' : 'user';
    } finally {
        if (btnIcon) setTimeout(() => btnIcon.classList.remove('fa-spin'), 500);
    }
};

document.getElementById('switch-camera-btn').onclick = window.switchCamera;

window.closeRecordingModal = () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
    }
    if (stream) {
        stream.getTracks().forEach(track => track.stop());
    }
    document.getElementById('recording-modal').classList.add('hidden');
    recordedChunks = [];
};

document.getElementById('start-record-btn').onclick = () => {
    recordedChunks = [];
    const options = {
        mimeType: 'video/webm;codecs=vp8,opus',
        videoBitsPerSecond: 2500000 // 2.5 Mbps for good quality
    };

    // Check supported types
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
        options.mimeType = 'video/webm';
    }

    mediaRecorder = new MediaRecorder(stream, options);

    mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunks.push(e.data);
    };

    mediaRecorder.onstop = () => {
        const preview = document.getElementById('recording-preview');
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        preview.srcObject = null;
        preview.src = URL.createObjectURL(blob);
        preview.controls = true;
        preview.muted = false;
        preview.play();
    };

    mediaRecorder.start();
    document.getElementById('recording-indicator').classList.remove('hidden');
    document.getElementById('start-record-btn').classList.add('hidden');
    document.getElementById('stop-record-btn').classList.remove('hidden');
    document.getElementById('shutter-label').textContent = 'STOP';
    document.getElementById('shutter-label').style.color = 'var(--error)';
};

document.getElementById('stop-record-btn').onclick = () => {
    mediaRecorder.stop();
    document.getElementById('recording-indicator').classList.add('hidden');
    document.getElementById('stop-record-btn').classList.add('hidden');

    // Show Post-record UI
    document.getElementById('post-record-actions').classList.remove('hidden');
    document.getElementById('save-section').classList.remove('hidden');
    document.getElementById('shutter-label').textContent = 'READY';
    document.getElementById('shutter-label').style.color = 'var(--success)';
};

document.getElementById('re-record-btn').onclick = () => {
    // Reset to record state
    document.getElementById('post-record-actions').classList.add('hidden');
    document.getElementById('save-section').classList.add('hidden');
    document.getElementById('start-record-btn').classList.remove('hidden');
    document.getElementById('shutter-label').textContent = 'Record';
    document.getElementById('shutter-label').style.color = '#fff';

    // Resume camera
    window.startCameraStream();
};

document.getElementById('save-record-btn').onclick = async () => {
    if (recordedChunks.length === 0) return;
    if (!googleAccessToken) {
        alert("YouTube access token missing. Please log in again to enable video uploads.");
        return;
    }

    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    if (blob.size === 0) {
        alert("Error: Video recording is empty. Please try recording again.");
        return;
    }

    const participantName = currentStudentName;
    const programName = currentProgramName;
    const participantId = currentParticipantId;

    // Background upload tracking
    activeUploads.set(participantId, { progress: 0, name: participantName });
    updateGlobalUploadUI();
    closeRecordingModal();

    try {
        await uploadToYouTube(blob, participantName, programName, participantId);
    } catch (error) {
        console.error("YouTube upload trigger failed:", error);
    }
};

async function uploadToYouTube(blob, participantName, programName, participantId) {
    const metadata = {
        snippet: {
            title: `${programName} - ${participantName} (${systemYear})`,
            description: `Performance recording for ${participantName} in ${programName}.\nUploaded via Stage Manager Portal.`,
            categoryId: '22'
        },
        status: {
            privacyStatus: 'unlisted',
            selfDeclaredMadeForKids: false
        }
    };

    try {
        console.log(`Starting YouTube upload logic for ${participantName}`);

        // Ensure we have the latest token
        googleAccessToken = sessionStorage.getItem('yt_token');

        if (!googleAccessToken) {
            log("Warning: No token in session. Trying to use local variable...");
        }

        if (!googleAccessToken) {
            alert("Your YouTube session has expired or is missing. Please sign out and sign in again to re-authorize YouTube uploads.");
            throw new Error("Missing YouTube access token");
        }

        console.log(`YouTube Token status: Present (Length: ${googleAccessToken.length}, Prefix: ${googleAccessToken.substring(0, 5)}...)`);

        // 1. Initiate Resumable Upload
        const initXhr = new XMLHttpRequest();
        // Reverting to youtube.googleapis.com as it handles CORS better for these requests
        const initUrl = 'https://youtube.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';

        const uploadUrl = await new Promise((resolve, reject) => {
            initXhr.open('POST', initUrl, true);
            initXhr.setRequestHeader('Authorization', `Bearer ${googleAccessToken}`);
            initXhr.setRequestHeader('Content-Type', 'application/json');
            initXhr.setRequestHeader('X-Upload-Content-Length', blob.size);
            initXhr.setRequestHeader('X-Upload-Content-Type', 'video/webm');

            initXhr.onload = () => {
                log(`YouTube Init Status: ${initXhr.status}`);
                if (initXhr.status >= 200 && initXhr.status < 300) {
                    const location = initXhr.getResponseHeader('Location');
                    if (location) resolve(location);
                    else reject(new Error("No upload location received from YouTube"));
                } else {
                    let errorMsg = `Initialization failed (${initXhr.status})`;
                    let details = "";
                    try {
                        const errResponse = JSON.parse(initXhr.responseText);
                        errorMsg = errResponse.error?.message || errorMsg;
                        details = JSON.stringify(errResponse.error);
                        console.error("YouTube Detailed Error:", errResponse);
                    } catch (e) {
                        console.error("Raw YouTube Error Response:", initXhr.responseText);
                    }

                    if (initXhr.status === 401 || initXhr.status === 403) {
                        window.needsReAuth = true;
                        reject(new Error(`Unauthorized (${initXhr.status}): ${errorMsg}. ${details}`));
                    } else {
                        reject(new Error(`${errorMsg} ${details}`));
                    }
                }
            };
            initXhr.onerror = () => {
                console.error("XHR Network Error Details:", initXhr);
                reject(new Error("Network error during upload initialization. Checks: 1. CORS origins in Cloud Console. 2. YouTube API enabled. 3. Channel exists."));
            };
            initXhr.send(JSON.stringify(metadata));
        });

        console.log("Upload session created. Starting data transfer...");

        // 2. Perform the actual upload
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl, true);
        xhr.setRequestHeader('Content-Type', 'video/webm');

        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
                const progress = Math.round((e.loaded / e.total) * 100);
                const info = activeUploads.get(participantId);
                if (info) {
                    info.progress = progress;
                    if (progress === 100) {
                        info.finalizing = true;
                    }
                    updateGlobalUploadUI();
                }
            }
        };

        xhr.onload = async () => {
            try {
                if (xhr.status >= 200 && xhr.status < 300) {
                    const response = JSON.parse(xhr.responseText);
                    const videoId = response.id;
                    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;

                    console.log(`YouTube upload successful: ${videoId}`);

                    // Update Firestore
                    const docRef = doc(db, "registrations", participantId);
                    await updateDoc(docRef, {
                        videoUrl: videoUrl,
                        youtubeId: videoId,
                        videoRecordedAt: new Date().toISOString()
                    });

                    // Update local status instead of deleting
                    const info = activeUploads.get(participantId);
                    if (info) {
                        info.progress = 100;
                        info.finalizing = false;
                        info.completed = true;
                        info.videoUrl = videoUrl;
                        info.youtubeId = videoId; // Store ID for immediate deletion if needed
                        updateGlobalUploadUI();
                    }

                    // Update local participants array to reflect changes in modal
                    const pIndex = currentParticipants.findIndex(p => p.id === participantId);
                    if (pIndex !== -1) {
                        currentParticipants[pIndex].videoUrl = videoUrl;
                        renderParticipantsList();
                    }

                } else {
                    let errorMsg = `Upload failed (${xhr.status})`;
                    try {
                        const errResponse = JSON.parse(xhr.responseText);
                        errorMsg = errResponse.error?.message || errorMsg;
                    } catch (e) { }
                    console.error("YouTube Data Upload Error Response:", xhr.responseText);
                    throw new Error(errorMsg);
                }
            } catch (err) {
                console.error("Error in upload completion handler:", err);
                const info = activeUploads.get(participantId);
                if (info) {
                    info.error = err.message;
                    info.finalizing = false;
                    updateGlobalUploadUI();
                }
            }
        };

        xhr.onerror = () => {
            throw new Error("Network error during video data transfer.");
        };

        xhr.send(blob);

    } catch (error) {
        console.error("Detailed YouTube Upload Error:", error);
        const currentInfo = activeUploads.get(participantId) || { name: participantName };
        const isAuthError = error.message.includes('Unauthorized') || error.message.includes('401') || error.message.includes('403');
        activeUploads.set(participantId, { ...currentInfo, error: error.message, isAuthError: isAuthError, blob: blob });
        updateGlobalUploadUI();
    }
}

window.reAuthAndRetry = async (participantId) => {
    const success = await window.reAuthorizeYouTube();
    if (success) {
        window.retryUpload(participantId);
    }
};

window.retryUpload = (participantId) => {
    const info = activeUploads.get(participantId);
    if (!info || !info.blob) return;

    const { blob, name } = info;
    activeUploads.set(participantId, { progress: 0, name: name });
    updateGlobalUploadUI();
    uploadToYouTube(blob, name, currentProgramName, participantId);
};

window.cancelUpload = (participantId) => {
    activeUploads.delete(participantId);
    updateGlobalUploadUI();
};

window.deleteVideo = async (participantId, youtubeId) => {
    if (!confirm("Are you sure you want to delete this recording? This will remove it from both this portal and YouTube.")) return;

    try {
        toggleLoading(true);

        // 1. Attempt YouTube Deletion
        if (youtubeId) {
            log(`Attempting to delete YouTube video: ${youtubeId}`);
            googleAccessToken = sessionStorage.getItem('yt_token');

            if (googleAccessToken) {
                try {
                    const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${youtubeId}`, {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Bearer ${googleAccessToken}`
                        }
                    });

                    if (response.ok) {
                        log("YouTube video deleted successfully.");
                    } else if (response.status === 401 || response.status === 403) {
                        log("YouTube deletion failed due to auth. Proceeding with Firestore unlinking anyway.");
                        console.warn("Auth error during YouTube deletion:", await response.text());
                    } else {
                        log(`YouTube deletion failed with status: ${response.status}. Proceeding with Firestore unlinking.`);
                        console.warn("YouTube API error:", await response.text());
                    }
                } catch (err) {
                    console.error("YouTube deletion error:", err);
                }
            } else {
                log("No YouTube token found. Skipping YouTube API deletion call, proceeding with Firestore unlinking.");
            }
        }

        // 2. Update Firestore
        const docRef = doc(db, "registrations", participantId);
        await updateDoc(docRef, {
            videoUrl: deleteField(),
            youtubeId: deleteField(),
            videoRecordedAt: deleteField()
        });

        // 3. Update local state
        const pIndex = currentParticipants.findIndex(p => p.id === participantId);
        if (pIndex !== -1) {
            delete currentParticipants[pIndex].videoUrl;
            delete currentParticipants[pIndex].youtubeId;
            delete currentParticipants[pIndex].videoRecordedAt;
        }

        // Remove from active uploads if present
        activeUploads.delete(participantId);
        updateGlobalUploadUI();

        renderParticipantsList();
        log("Video unlinked/deleted successfully from portal.");

    } catch (error) {
        console.error("Deletion failed:", error);
        alert("Deletion failed: " + error.message);
    } finally {
        toggleLoading(false);
    }
};

function log(msg) {
    console.log(`[Stage Manager] ${msg}`);
}
function updateGlobalUploadUI() {
    const container = document.getElementById('global-upload-container');
    if (!container) return;
    container.innerHTML = '';

    activeUploads.forEach((info, id) => {
        const progress = info.progress || 0;
        const isError = !!info.error;
        const isCompleted = !!info.completed;
        const isFinalizing = !!info.finalizing;
        const div = document.createElement('div');
        div.className = 'upload-toast' + (isError ? ' error' : isCompleted ? ' success' : '');

        let content = '';
        if (isError) {
            content = `
                <div style="font-size: 0.75rem; margin-bottom: 4px; display: flex; justify-content: space-between;">
                    <span>❌ Failed: <b>${info.name}</b></span>
                </div>
                <div style="font-size: 0.65rem; color: #fca5a5; margin-top: 4px;">${info.error}</div>
                <div style="margin-top: 8px; display: flex; gap: 8px;">
                    ${info.isAuthError ?
                    `<button onclick="window.reAuthAndRetry('${id}')" style="background: var(--accent-primary); border: none; color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.65rem; cursor: pointer;">Fix & Retry</button>` :
                    `<button onclick="window.retryUpload('${id}')" style="background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; padding: 4px 8px; border-radius: 4px; font-size: 0.65rem; cursor: pointer;">Retry</button>`
                }
                    <button onclick="window.cancelUpload('${id}')" style="background: transparent; border: none; color: #94a3b8; font-size: 0.65rem; cursor: pointer;">Dismiss</button>
                </div>`;
        } else if (isCompleted) {
            content = `
                <div style="font-size: 0.75rem; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center;">
                    <span>✅ Uploaded: <b>${info.name}</b></span>
                    <button onclick="window.cancelUpload('${id}')" style="background: transparent; border: none; color: #94a3b8; cursor: pointer; padding: 0 4px;"><i class="fas fa-times"></i></button>
                </div>
                <div style="margin-top: 8px; display: flex; gap: 8px;">
                    <a href="${info.videoUrl}" target="_blank" style="background: var(--success); text-decoration: none; color: white; padding: 4.5px 12px; border-radius: 4px; font-size: 0.7rem; display: flex; align-items: center; gap: 6px; font-weight: 600;">
                        <i class="fab fa-youtube"></i> View Video
                    </a>
                </div>`;
        } else {
            content = `
                <div style="font-size: 0.75rem; margin-bottom: 4px; display: flex; justify-content: space-between;">
                    <span>${isFinalizing ? '<i class="fas fa-spinner fa-spin"></i> Finalizing' : 'To YouTube'}: <b>${info.name}</b></span>
                    <span>${progress}%</span>
                </div>
                <div class="pro-progress-container" style="height: 4px; margin-top: 4px;">
                    <div class="pro-progress-fill" style="width: ${progress}%"></div>
                </div>`;
        }

        div.innerHTML = content;
        container.appendChild(div);
    });
}

window.closeModal = () => {
    document.getElementById('participant-modal').classList.add('hidden');
};
