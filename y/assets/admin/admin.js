import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc, collection, getDocs, query, where, orderBy, addDoc, deleteDoc, updateDoc, onSnapshot, limit, increment, deleteField } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { getDatabase, ref, set, push, onDisconnect, onValue, serverTimestamp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-database.js";
import { firebaseConfig } from "../core/firebase-config.js";

// Logger helper
const debugContent = document.getElementById('debug-content');
function log(msg, data = null) {
    console.log(msg, data || "");
    const timestamp = new Date().toLocaleTimeString();
    const div = document.createElement('div');
    div.style.marginBottom = "0.5rem";
    div.style.borderBottom = "1px solid rgba(255,255,255,0.05)";
    div.style.paddingBottom = "0.25rem";

    let dataStr = "";
    if (data) {
        try {
            dataStr = `<pre style="margin:0;color:#94a3b8;font-size:0.75rem;">${JSON.stringify(data, null, 2)}</pre>`;
        } catch (e) { dataStr = String(data); }
    }

    div.innerHTML = `<span style="color:#64748b">[${timestamp}]</span> <span style="color:#e2e8f0">${msg}</span> ${dataStr}`;
    if (debugContent) debugContent.appendChild(div);
}

// Config imported above

// Initialize Firebase
log("Initializing Firebase...");
let db;
let auth;
let rtdb;
const provider = new GoogleAuthProvider();

const APP_VERSION = "1.0.3";

// SECRET CORE ACCESS (5 clicks on any Logo)
setTimeout(() => {
    const adminLogos = document.querySelectorAll('.login-logo, .sidebar-logo');
    let adminLogoClickCount = 0;
    let adminLogoClickTimer = null;

    adminLogos.forEach(logo => {
        logo.style.cursor = 'pointer';
        logo.addEventListener('click', (e) => {
            e.preventDefault();

            clearTimeout(adminLogoClickTimer);
            adminLogoClickTimer = setTimeout(() => {
                adminLogoClickCount = 0;
            }, 2000);

            adminLogoClickCount++;

            if (adminLogoClickCount === 5) {
                adminLogoClickCount = 0;

                // Fade out and Redirect
                document.body.style.transition = "opacity 0.5s ease";
                document.body.style.opacity = "0";

                // Simple audio feedback
                try {
                    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                    const osc = audioCtx.createOscillator();
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(100, audioCtx.currentTime);
                    osc.start();
                    osc.stop(audioCtx.currentTime + 0.2);
                } catch (e) { }

                setTimeout(() => {
                    window.location.replace('https://unionartsprccoreadmin.web.app');
                }, 500);
            }
        });
    });
}, 1000);

// Global system year variable (must be declared before try block)
let systemYear = "2025-26"; // Default fallback

// Listen to system year in real-time
let systemYearListener = null;
function startSystemYearListener() {
    if (systemYearListener) return;
    const yearRef = doc(db, "system_config", "current_year");
    systemYearListener = onSnapshot(yearRef, (docSnap) => {
        let oldYear = systemYear;
        if (docSnap.exists()) {
            const data = docSnap.data();
            systemYear = data.year || "2025-26";
            log(`System year updated in real-time: ${systemYear}`);
        } else {
            log("No system year configured, using default: 2025-26");
            systemYear = "2025-26";
        }

        // Update UI elements
        const sidebarYearText = document.getElementById('sidebar-year-text');
        sidebarYearText.textContent = systemYear;


        // If the year changed after initial load, refresh data automatically
        if (isAppInitialized && oldYear !== systemYear) {
            log("Year changed! Refreshing all data...");
            refreshAll();
            if (currentView === 'whitelist') fetchWhitelist();
        }
    }, (error) => {
        console.error("Year listener Encountered an error:", error);
        log("Year listener encounterd an error, attempting to restart...");
        systemYearListener = null;
    });
}

// Deprecated helper but kept for compatibility with any remaining calls
window.fetchSystemYear = async function () {
    try {
        const yearDoc = await getDoc(doc(db, "system_config", "current_year"));
        if (yearDoc.exists()) {
            systemYear = yearDoc.data().year || "2025-26";
        }
        const sidebarYearText = document.getElementById('sidebar-year-text');
        if (sidebarYearText) sidebarYearText.textContent = systemYear;
    } catch (e) {
        console.error("Manual year fetch failed:", e);
    }
};

try {
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app);
    auth = getAuth(app);
    rtdb = getDatabase(app);
    log("Firebase initialized successfully.");

    // Initialize system year listener
    startSystemYearListener();

    log("Firebase initialized.");
} catch (e) {
    log("Initialization error:", e.message);
}

const loginView = document.getElementById('login-view');
const adminDashboard = document.getElementById('admin-dashboard');
const statusMsg = document.getElementById('status-message');
const googleLoginBtn = document.getElementById('google-login-btn');
const logoutBtn = document.getElementById('logout-btn');
const userEmailSpan = document.getElementById('user-email');
const regBody = document.getElementById('registrations-body');
const whitelistBody = document.getElementById('whitelist-body');
const loadingInd = document.getElementById('loading-indicator');
const noDataMsg = document.getElementById('no-data-msg');


let allRegistrations = [];
let leaderboardScores = {};
let programDates = {};

let currentView = 'registrations';
let currentRegTab = 'On Stage';
let currentUserRole = '';
let currentUserDept = '';
let currentUserAllowedCourses = [];
let currentFilters = {
    search: '',
    dept: '',
    year: '',
    item: '',
    regType: ''
};

const OFF_STAGE_EVENTS = [
    "Essay Writing (English)", "Essay Writing (Arabic)", "Essay Writing (Hindi)", "Essay Writing (Malayalam)", "Essay Writing (Tamil)", "Essay Writing (Urdu)",
    "Story Writing (English)", "Story Writing (Arabic)", "Story Writing (Hindi)", "Story Writing (Malayalam)", "Story Writing (Tamil)", "Story Writing (Urdu)",
    "Versification (English)", "Versification (Arabic)", "Versification (Hindi)", "Versification (Malayalam)", "Versification (Tamil)", "Versification (Urdu)",
    "Extempore (English)", "Extempore (Hindi)", "Extempore (Malayalam)", "Extempore (Tamil)",
    "Aksharashlokam",
    "Kavyakeli",
    "Water Colour",
    "Oil Colour",
    "Cartoon Drawing",
    "Pencil Drawing",
    "Clay Modeling",
    "Collage",
    "Embroidery",
    "Poster Making",
    "Rangoli",
    "Spot Photography"
];

const ON_STAGE_INDIVIDUAL_EVENTS = [
    "Light Music Boys", "Light Music Girls",
    "Classical Music Boys", "Classical Music Girls",
    "Mappila Pattu Boys", "Mappila Pattu Girls",
    "Western Song",
    "Poem Recitation (Malayalam)", "Poem Recitation (English)", "Poem Recitation (Hindi)", "Poem Recitation (Arabic)", "Poem Recitation (Tamil)", "Poem Recitation (Urdu)",
    "Percussion Instruments Eastern",
    "String Instruments Eastern",
    "String Instruments Western",
    "Bharatanatyam",
    "Mohiniyattam",
    "Classical Dance (Odissi)", "Classical Dance (Kathak)", "Classical Dance (Manipuri)", "Classical Dance (Kuchipudi)",
    "Folk Dance Boys", "Folk Dance Girls",
    "Kerala Natanam",
    "Monoact",
    "Mimicry",
    "Kadha Presangam"
];

const ON_STAGE_GROUP_EVENTS = [
    "Group Song (Indian)",
    "Group Song (Western)",
    "Mappila Paattu Group",
    "Folk Music Group",
    "Patriotic Song Group",
    "Ganamela",
    "Folk Dance Group",
    "Thiruvathira",
    "Kolkali",
    "Daf Mutt",
    "Oppana",
    "Vattapatt",
    "Margamkali",
    "Drama",
    "Mime",
    "Skit"
];

const ON_STAGE_EVENTS = [...ON_STAGE_INDIVIDUAL_EVENTS, ...ON_STAGE_GROUP_EVENTS];
const ALL_PROGRAMS = [...ON_STAGE_EVENTS, ...OFF_STAGE_EVENTS].sort();


const DEPARTMENTS = [
    "Dep. of Economics",
    "Dep. of English",
    "Dep. of History",
    "Dep. of Microbiology",
    "Dep. of Travel and Tourism",
    "Dep. of Journalism and Mass Communication",
    "Dep. of Biochemistry",
    "Dep. of Commerce"
];

const DEPT_COURSES = {
    "Dep. of Economics": ["B.A Economics", "B.A Econometrics and Data Management", "M.A Economics"],
    "Dep. of English": ["B.A English Language and Literature"],
    "Dep. of History": ["B.A History"],
    "Dep. of Microbiology": ["B.Sc Microbiology", "M.Sc Microbiology"],
    "Dep. of Travel and Tourism": ["Bachelor of Travel and Tourism Management (BTTM)", "Master of Travel and Tourism Management (MTTM)"],
    "Tourism": ["Bachelor of Travel and Tourism Management (BTTM)", "Master of Travel and Tourism Management (MTTM)"],
    "Dep. of Journalism and Mass Communication": ["B.A Journalism and Mass Communication", "M.A Journalism & Mass Communication"],
    "Dep. of Biochemistry": ["B.Sc Biochemistry", "M.Sc Biochemistry"],
    "Dep. of Commerce": ["BBA", "M.COM"]
};



// Set Default User
if (userEmailSpan) userEmailSpan.textContent = "Admin User";

// --- Functions first ---

const escapeHtml = (unsafe) => {
    if (unsafe === null || unsafe === undefined) return "";
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
};

const updateStats = () => {
    const activeRegistrations = allRegistrations.filter(r => !r.isDeleted);
    const totalReg = activeRegistrations.length;
    document.getElementById('stat-total-reg').textContent = totalReg;

    const deptCounts = {};
    activeRegistrations.forEach(r => {
        deptCounts[r.department] = (deptCounts[r.department] || 0) + 1;
    });
    let topDept = 'N/A';
    let maxCount = 0;
    for (const dept in deptCounts) {
        if (deptCounts[dept] > maxCount) {
            maxCount = deptCounts[dept];
            topDept = dept;
        }
    }
    if (topDept.length > 15) topDept = topDept.substring(0, 15) + '...';
    document.getElementById('stat-top-dept').textContent = topDept;
};

const populateItemFilter = () => {
    const itemSelect = document.getElementById('filter-item');
    if (!itemSelect) return;

    // Save current selection to restore if possible
    const currentSelection = itemSelect.value;

    // Clear current options except first
    itemSelect.innerHTML = '<option value="">All Items</option>';

    // Get items from current tab's registrations
    const filteredByTab = allRegistrations.filter(r => (r.category || "").trim() === currentRegTab);
    const items = new Set();

    filteredByTab.forEach(r => {
        if (r.program) items.add(r.program);
    });

    // Sort and append
    Array.from(items).sort().forEach(item => {
        const option = document.createElement('option');
        option.value = item;
        option.textContent = item;
        itemSelect.appendChild(option);
    });

    // Restore selection if it exists in new list, otherwise reset
    if (currentSelection && items.has(currentSelection)) {
        itemSelect.value = currentSelection;
        currentFilters.item = currentSelection; // Ensure filter state matches
    } else {
        itemSelect.value = "";
        currentFilters.item = ""; // Reset filter if item no longer exists in view
    }
};

const matchesRegistration = (student, filterDept, filterCategory, filterType, filterSearch = '', filterYear = '', filterItem = '') => {
    // Exclude deleted items from all matching logic
    if (student.isDeleted) return false;

    // Category Match (always required in some views)
    if (filterCategory && (student.category || "").trim().toLowerCase() !== filterCategory.toLowerCase()) return false;

    // Department Match (matches shorthand OR full course name OR substring)
    if (filterDept) {
        const allowedCourses = DEPT_COURSES[filterDept] || [];
        const studentDept = (student.department || "").toLowerCase().trim();
        const filterVal = filterDept.toLowerCase().trim();
        const shortFilter = filterDept.replace('Dep. of ', '').toLowerCase().trim();

        const isExactMatch = student.department === filterDept;
        const isInAllowedCourses = allowedCourses.some(c => c.toLowerCase().trim() === studentDept);
        const containsShortName = shortFilter !== '' && studentDept.includes(shortFilter);
        const isMappedMatch = allowedCourses.some(c => {
            const mappedShort = c.replace('Dep. of ', '').toLowerCase().trim();
            return mappedShort !== '' && studentDept.includes(mappedShort);
        });

        if (!isExactMatch && !isInAllowedCourses && !containsShortName && !isMappedMatch) return false;
    }

    // Registration Type Match
    if (filterType) {
        const expected = filterType.toLowerCase() === 'individual' ? 'Individual' : 'Group';
        if ((student.regType || 'Individual') !== expected) return false;
    }

    // Additional Search Filters
    if (filterSearch) {
        const search = filterSearch.toLowerCase();
        const matches = (student.studentName || "").toLowerCase().includes(search) ||
            (student.rollNumber || "").toLowerCase().includes(search);
        if (!matches) return false;
    }

    if (filterYear && student.year !== filterYear) return false;
    if (filterItem && student.program !== filterItem) return false;

    return true;
};

const renderTable = () => {
    if (!regBody) return;
    regBody.innerHTML = '';

    const filtered = allRegistrations.filter(student =>
        matchesRegistration(student,
            currentFilters.dept,
            currentRegTab,
            currentFilters.regType,
            currentFilters.search,
            currentFilters.year,
            currentFilters.item
        )
    );

    if (filtered.length === 0) {
        noDataMsg.classList.remove('hidden');
    } else {
        noDataMsg.classList.add('hidden');
    }

    filtered.forEach(student => {
        const date = student.registeredAt ? new Date(student.registeredAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'N/A';
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.onclick = (e) => {
            // Don't trigger if clicked on action buttons
            if (e.target.closest('button') || e.target.closest('i')) return;
            viewRegistration(student.id);
        };

        tr.innerHTML = `
                    <td>
                        <div style="font-weight: 600;">
                            ${student.regType === 'Group' ? escapeHtml(student.groupName || student.studentName || '-') : escapeHtml(student.studentName || '-')}
                            ${student.isCanceled ? '<span class="badge" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; margin-left: 8px; font-size: 0.65rem; border: 1px solid rgba(239, 68, 68, 0.2);">CANCELED</span>' : ''}
                        </div>
                        ${student.regType === 'Group' ?
                `<div style="font-size: 0.75rem; color: var(--accent-primary); font-weight: 700;">
                                ${student.groupMembers?.length ? `<span style="font-weight: 400; color: var(--text-muted);">(${student.groupMembers.length} Members)</span>` : ''}
                                ${student.studentName ? `<span style="font-weight: 400; color: var(--text-muted); margin-left: 5px;">Leader: ${escapeHtml(student.studentName)}</span>` : ''}
                            </div>` :
                (student.groupName ? `<div style="font-size: 0.75rem; color: var(--accent-primary); font-weight: 700;">${escapeHtml(student.groupName)}</div>` : '')
            }
                        <div style="font-size: 0.7rem; color: var(--text-muted);">${escapeHtml(student.phone || '-')}</div>
                    </td>
                    <td><span class="badge badge-dept">${(student.department || '-').replace('Dep. of ', '')}</span></td>
                    <td><code>${escapeHtml(student.rollNumber || '-')}</code></td>
                    <td>${escapeHtml(student.year || '-')}</td>
                    <td><span class="badge" style="background: ${student.regType === 'Group' ? 'rgba(217, 70, 239, 0.1)' : 'rgba(99, 102, 241, 0.1)'}; color: ${student.regType === 'Group' ? 'var(--accent-secondary)' : 'var(--accent-primary)'};">${escapeHtml(student.regType || 'Individual')}</span></td>
                    <td><div style="font-weight: 500;">${escapeHtml(student.program || '-')}</div></td>
                    <td><span style="font-size: 0.8rem; color: var(--text-muted);">${date}</span></td>
                    <td>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">
                            ${(() => {
                const pData = programDates[student.program];
                if (!pData) return '<span style="opacity: 0.5">TBD</span>';
                return `
                                    <div style="color: var(--accent-primary); font-weight: 600;">${pData.date || 'Date TBD'}</div>
                                    <div style="font-size: 0.7rem; color: var(--text-secondary);">${pData.stage || 'Stage TBD'}</div>
                                `;
            })()}
                        </div>
                    </td>
                <td>
                    <div style="display: flex; gap: 0.75rem;">
                        <button onclick="openEditModal('${student.id}')" title="Edit" style="color: var(--accent-primary); background: none; border: none; cursor: pointer;"><i class="fas fa-edit"></i></button>
                        <button onclick="deleteRegistration('${student.id}', '${escapeHtml((student.studentName || 'Student').replace(/'/g, "\\'"))}')" title="Move to Trash" style="color: var(--error); background: none; border: none; cursor: pointer;"><i class="fas fa-trash"></i></button>
                    </div>
                </td>
                `;
        regBody.appendChild(tr);
    });
    updateStats();
};


const renderLeaderboard = () => {
    const lbBody = document.getElementById('leaderboard-body');
    if (!lbBody) return;
    lbBody.innerHTML = '';

    DEPARTMENTS.forEach(dept => {
        const score = leaderboardScores[dept] || 0;
        const tr = document.createElement('tr');
        const safeDept = dept.replace(/\s+/g, '-');
        tr.innerHTML = `
                    <td style="font-weight: 600; cursor: pointer; transition: color 0.2s;" 
                        onmouseover="this.style.color='var(--accent-color)'" 
                        onmouseout="this.style.color=''"
                        onclick="openAnalysisModal('${dept}')">
                        ${dept}
                    </td>
                    <td style="color: var(--accent-color); font-weight: 800; font-size: 1.1rem;">${score}</td>
                    <td>
                        <button onclick="openScoreModal('${dept}')" class="btn-tab active" style="padding: 0.4rem 0.75rem; font-size: 0.75rem;">Add Score</button>
                    </td>
                `;
        lbBody.appendChild(tr);
    });
};

const fetchLeaderboard = async () => {
    log("Fetching leaderboard scores...");
    try {
        const q = query(collection(db, "leaderboard"), where("academicYear", "==", systemYear));
        const querySnapshot = await getDocs(q);
        leaderboardScores = {};
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            leaderboardScores[data.department] = data.score || 0;
        });
        log("Leaderboard scores fetched:", leaderboardScores);
        if (currentView === 'leaderboard') renderLeaderboard();

    } catch (error) {
        log("Error fetching leaderboard:", error);
    }
};

let whitelistedEmails = [];
const fetchWhitelist = async () => {
    log("Fetching whitelisted emails...");
    try {
        const q = query(
            collection(db, "whitelisted_emails"),
            where("academicYear", "==", systemYear)
        );
        const querySnapshot = await getDocs(q);
        whitelistedEmails = [];
        querySnapshot.forEach((doc) => {
            whitelistedEmails.push({ id: doc.id, ...doc.data() });
        });
        // Sort client-side to avoid index requirement
        whitelistedEmails.sort((a, b) => {
            const dateA = a.addedAt ? new Date(a.addedAt).getTime() : 0;
            const dateB = b.addedAt ? new Date(b.addedAt).getTime() : 0;
            return dateB - dateA;
        });
        log(`Whitelist fetched for ${systemYear}. Found ${whitelistedEmails.length} emails.`);
        if (currentView === 'whitelist') {
            renderWhitelist();
        }

    } catch (error) {
        log("Error fetching whitelist:", error);
    }
};

let registrationSettings = { onStageLocked: false, offStageLocked: false };
const fetchSettings = async () => {
    log("Fetching registration settings...");
    try {
        const docRef = doc(db, "settings", "registration");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            registrationSettings = docSnap.data();
        } else {
            // Initialize
            await setDoc(docRef, registrationSettings);
        }
        updateSettingsUI();
    } catch (error) {
        log("Error fetching settings:", error);
    }
};

const updateSettingsUI = () => {
    const onBtn = document.getElementById('on-stage-lock-btn');
    const offBtn = document.getElementById('off-stage-lock-btn');
    const onStatus = document.getElementById('on-stage-status');
    const offStatus = document.getElementById('off-stage-status');

    if (onBtn) {
        // On Stage
        if (registrationSettings.onStageLocked) {
            onBtn.innerHTML = '<i class="fas fa-lock"></i>';
            onBtn.style.background = 'rgba(239, 68, 68, 0.2)';
            onBtn.style.color = 'var(--error)';
            onBtn.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.2)';
        } else {
            onBtn.innerHTML = '<i class="fas fa-lock-open"></i>';
            onBtn.style.background = 'rgba(16, 185, 129, 0.2)';
            onBtn.style.color = 'var(--success)';
            onBtn.style.boxShadow = '0 0 15px rgba(16, 185, 129, 0.2)';
        }
        // Update click handler to correct negation
        onBtn.onclick = () => toggleRegLock('onStageLocked', !registrationSettings.onStageLocked);
    }

    if (offBtn) {
        // Off Stage
        if (registrationSettings.offStageLocked) {
            offBtn.innerHTML = '<i class="fas fa-lock"></i>';
            offBtn.style.background = 'rgba(239, 68, 68, 0.2)';
            offBtn.style.color = 'var(--error)';
            offBtn.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.2)';
        } else {
            offBtn.innerHTML = '<i class="fas fa-lock-open"></i>';
            offBtn.style.background = 'rgba(16, 185, 129, 0.2)';
            offBtn.style.color = 'var(--success)';
            offBtn.style.boxShadow = '0 0 15px rgba(16, 185, 129, 0.2)';
        }
        // Update click handler to correct negation
        offBtn.onclick = () => toggleRegLock('offStageLocked', !registrationSettings.offStageLocked);
    }

    if (onStatus) {
        onStatus.textContent = registrationSettings.onStageLocked ? "Locked" : "Active";
        onStatus.style.color = registrationSettings.onStageLocked ? "var(--error)" : "var(--success)";
    }
    if (offStatus) {
        offStatus.textContent = registrationSettings.offStageLocked ? "Locked" : "Active";
        offStatus.style.color = registrationSettings.offStageLocked ? "var(--error)" : "var(--success)";
    }
};

window.toggleRegLock = async (field, isLocked) => {
    log(`Toggling registration lock for ${field} to ${isLocked}`);
    try {
        const docRef = doc(db, "settings", "registration");
        await updateDoc(docRef, { [field]: isLocked });
        registrationSettings[field] = isLocked;
        updateSettingsUI();
    } catch (error) {
        log("Error updating settings:", error);
        alert("Failed to update registration status: " + error.message);
        updateSettingsUI(); // Revert UI
    }
};

const renderWhitelist = () => {
    if (!whitelistBody) return;
    whitelistBody.innerHTML = '';

    if (whitelistedEmails.length === 0) {
        whitelistBody.innerHTML = '<tr><td colspan="6" style="text-align: center; padding: 2rem; color: var(--text-secondary);">No whitelisted emails found.</td></tr>';
        return;
    }

    whitelistedEmails.forEach(item => {
        const date = item.addedAt ? new Date(item.addedAt).toLocaleString() : 'N/A';

        const offStageIcon = item.canRegisterOffStage ?
            '<i class="fas fa-check-circle" style="color: #10b981;" title="Off Stage Allowed"></i>' :
            '<i class="fas fa-times-circle" style="color: rgba(255,255,255,0.1);" title="Off Stage Restricted"></i>';

        const onStageIcon = item.canRegisterOnStage ?
            '<i class="fas fa-check-circle" style="color: #10b981;" title="On Stage Allowed"></i>' :
            '<i class="fas fa-times-circle" style="color: rgba(255,255,255,0.1);" title="On Stage Restricted"></i>';

        const tr = document.createElement('tr');
        tr.innerHTML = `
                    <td style="font-weight: 500;">
                        ${item.email}
                    </td>
                    <td>
                        <span class="badge" style="background: ${item.role === 'Sub' ? 'rgba(168, 85, 247, 0.1)' : item.role === 'Leaderboard' ? 'rgba(251, 191, 36, 0.1)' : 'rgba(99, 102, 241, 0.1)'}; color: ${item.role === 'Sub' ? 'var(--accent-secondary)' : item.role === 'Leaderboard' ? '#fbbf24' : 'var(--accent-primary)'}; border: 1px solid ${item.role === 'Sub' ? 'rgba(168, 85, 247, 0.2)' : item.role === 'Leaderboard' ? 'rgba(251, 191, 36, 0.2)' : 'rgba(99, 102, 241, 0.2)'};">
                            ${item.role || 'Main'}
                        </span>
                    </td>
                    <td style="color: var(--accent-color); font-weight: 600;">
                        ${item.department || 'N/A'}
                        ${item.role === 'Stage Manager' && item.assignedStage ? `<div style="font-size: 0.75rem; color: var(--text-muted);">Stage: ${item.assignedStage}</div>` : ''}
                    </td>
                    <td style="color: var(--text-secondary); font-size: 0.8rem;">${date}</td>
                    <td>
                        <div style="display: flex; gap: 1rem; align-items: center;">
                            <div style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer;" onclick="toggleWhitelistPermission('${item.id}', 'canRegisterOffStage', ${!item.canRegisterOffStage})">
                                ${offStageIcon} <span style="font-size: 0.7rem; color: var(--text-secondary);">Off</span>
                            </div>
                            <div style="display: flex; align-items: center; gap: 0.4rem; cursor: pointer;" onclick="toggleWhitelistPermission('${item.id}', 'canRegisterOnStage', ${!item.canRegisterOnStage})">
                                ${onStageIcon} <span style="font-size: 0.7rem; color: var(--text-secondary);">On</span>
                            </div>
                        </div>
                    </td>
                    <td>
                        <div style="display: flex; gap: 0.5rem;">
                            <button onclick="removeFromWhitelist('${item.id}', '${item.email}')" 
                                style="background: rgba(239, 68, 68, 0.1); border: none; color: #ef4444; padding: 0.4rem 0.6rem; border-radius: 0.4rem; cursor: pointer; font-size: 0.75rem; transition: background 0.2s;">
                                Remove
                            </button>
                        </div>
                    </td>
                `;
        whitelistBody.appendChild(tr);
    });
};



window.addToWhitelist = async () => {
    const emailInput = document.getElementById('new-whitelist-email');
    const deptInput = document.getElementById('new-whitelist-dept');
    const statusMsg = document.getElementById('whitelist-status');
    const email = emailInput.value.trim().toLowerCase();
    const role = document.getElementById('new-whitelist-role').value;
    const department = (role === 'Leaderboard' || role === 'Stage Manager') ? (role === 'Stage Manager' ? 'Stage Management' : 'Global Leaderboard') : deptInput.value;

    if (!email || !email.includes('@')) {
        statusMsg.innerHTML = '<span class="error">Please enter a valid email.</span>';
        return;
    }

    if (!department && role !== 'Leaderboard' && role !== 'Chest' && role !== 'Stage Manager') {
        statusMsg.innerHTML = '<span class="error">Please select a department.</span>';
        return;
    }

    if (role === 'Stage Manager' && !document.getElementById('new-whitelist-stage').value.trim()) {
        statusMsg.innerHTML = '<span class="error">Please enter an assigned stage.</span>';
        return;
    }

    if (whitelistedEmails.some(item => item.email === email)) {
        statusMsg.innerHTML = '<span class="error">This email is already in the whitelist.</span>';
        return;
    }

    const btn = document.getElementById('add-to-whitelist-btn');
    btn.disabled = true;
    statusMsg.innerHTML = '<span style="color: var(--text-secondary)">Adding user...</span>';

    try {
        // Get allowed courses for this department for Firestore rules
        const allowedCourses = (role === 'Leaderboard' || role === 'Chest') ? [] : (DEPT_COURSES[department] || []);
        const emailLower = email.toLowerCase();
        const yearScopedId = `${emailLower}_${systemYear}`;

        const stageInput = document.getElementById('new-whitelist-stage');
        const assignedStage = role === 'Stage Manager' ? stageInput.value.trim() : null;

        await setDoc(doc(db, "whitelisted_emails", yearScopedId), {
            email: email,
            role: role,
            department: department,
            assignedStage: assignedStage,
            allowedCourses: allowedCourses,
            canRegisterOffStage: document.getElementById('new-whitelist-can-offstage').checked,
            canRegisterOnStage: document.getElementById('new-whitelist-can-onstage').checked,
            academicYear: systemYear,
            addedAt: new Date().toISOString()
        });
        log(`Added ${email} to whitelist for ${systemYear} with department ${department} and stage ${assignedStage}.`);

        emailInput.value = '';
        deptInput.value = '';
        if (stageInput) stageInput.value = '';
        document.getElementById('new-whitelist-can-offstage').checked = false;

        document.getElementById('new-whitelist-can-onstage').checked = false;
        statusMsg.innerHTML = '<span class="success">User added successfully!</span>';
        fetchWhitelist();
    } catch (error) {
        log("Error adding to whitelist:", error);
        statusMsg.innerHTML = `<span class="error">Error: ${error.message}</span>`;
    } finally {
        btn.disabled = false;
    }
};

window.toggleWhitelistPermission = async (id, field, newValue) => {
    try {
        // Since ID is now email, we can use it directly
        await updateDoc(doc(db, "whitelisted_emails", id), {
            [field]: newValue
        });
        log(`Updated whitelist permission ${field} to ${newValue} for user ${id}`);
        fetchWhitelist();
    } catch (error) {
        log("Error updating whitelist permission:", error);
        alert("Error: " + error.message);
    }
};

window.removeFromWhitelist = async (id, email) => {
    if (!confirm(`Are you sure you want to remove ${email} from the whitelist?`)) return;

    try {
        // ID is the email
        await deleteDoc(doc(db, "whitelisted_emails", id));
        log(`Removed ${email} from whitelist.`);
        fetchWhitelist();
    } catch (error) {
        log("Error removing from whitelist:", error);
        alert("Error: " + error.message);
    }
};

window.toggleParticipantFields = () => {
    const type = document.getElementById('score-type').value;
    const nameLabel = document.getElementById('score-name-label');

    if (type === 'individual') {
        nameLabel.textContent = "Participant Name";
    } else {
        nameLabel.textContent = "Leader or Group Name";
    }
};

window.onScoreCategoryChange = () => {
    const category = document.getElementById('score-category').value;
    const scoreType = document.getElementById('score-type');
    const optGroup = document.getElementById('opt-group');
    const dept = document.getElementById('score-dept-id').value;

    if (category === 'Off Stage') {
        scoreType.value = 'individual';
        if (optGroup) optGroup.disabled = true;
    } else {
        if (optGroup) optGroup.disabled = false;
    }

    toggleParticipantFields();
    populateScoreItems(dept);
    calculatePoints();
};

window.onScoreTypeChange = () => {
    const dept = document.getElementById('score-dept-id').value;
    toggleParticipantFields();
    populateScoreItems(dept);
    calculatePoints();
};

window.calculatePoints = () => {
    const type = document.getElementById('score-type').value;
    const position = document.getElementById('score-position').value;
    const pointsInput = document.getElementById('score-points');

    let points = 5; // Default

    if (type === 'individual') {
        if (position === '1st') points = 5;
        else if (position === '2nd') points = 3;
        else if (position === '3rd') points = 1;
        else points = 0;
    } else {
        // Group / General
        if (position === '1st') points = 10;
        else if (position === '2nd') points = 6;
        else if (position === '3rd') points = 2;
        else points = 0;
    }

    pointsInput.value = points;
};

window.populateScoreItems = (dept) => {
    const itemSelect = document.getElementById('score-item');
    const category = document.getElementById('score-category').value;
    const scoreType = document.getElementById('score-type').value;

    itemSelect.innerHTML = '<option value="">Select Item</option>';
    const items = new Set();
    let matchCount = 0;

    allRegistrations.forEach(r => {
        if (matchesRegistration(r, dept, category, scoreType)) {
            matchCount++;
            if (r.program) items.add(r.program);
        }
    });

    console.log(`Dropdown Debug: Found ${matchCount} matching registrations for ${dept}, ${category}, ${scoreType}. Final unique items: ${items.size}`);
    if (matchCount === 0) {
        log(`DEBUG: No matches for ${dept} | ${category} | ${scoreType}. Samples checked: ${allRegistrations.length}`);
    }

    Array.from(items).sort().forEach(item => {
        const option = document.createElement('option');
        option.value = item;
        option.textContent = item;
        itemSelect.appendChild(option);
    });

    document.getElementById('score-participant').innerHTML = '<option value="">Select Item First</option>';
};

window.populateScoreParticipants = () => {
    const dept = document.getElementById('score-dept-id').value;
    const category = document.getElementById('score-category').value;
    const scoreType = document.getElementById('score-type').value;
    const item = document.getElementById('score-item').value;
    const participantSelect = document.getElementById('score-participant');

    participantSelect.innerHTML = '<option value="">Select Participant</option>';
    if (!item) return;

    const participants = allRegistrations.filter(r =>
        matchesRegistration(r, dept, category, scoreType, '', '', item)
    );

    participants.forEach(p => {
        const option = document.createElement('option');
        const displayName = p.regType === 'Group' ? (p.groupName || p.studentName || '-') : (p.studentName || '-');
        option.value = displayName;
        option.textContent = displayName;
        participantSelect.appendChild(option);
    });
};

window.openScoreModal = (dept) => {
    const modal = document.getElementById('score-modal');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
    document.getElementById('score-dept-id').value = dept;
    document.getElementById('score-dept-display').textContent = `Department: ${dept}`;
    document.getElementById('score-points').value = 5;
    document.getElementById('score-category').value = 'On Stage';
    document.getElementById('score-type').value = 'general';
    document.getElementById('score-position').value = 'None';

    const optGroup = document.getElementById('opt-group');
    if (optGroup) optGroup.disabled = false;

    // Populate Dropdowns
    populateScoreItems(dept);
    document.getElementById('score-participant').innerHTML = '<option value="">Select Item First</option>';
    toggleParticipantFields();
    calculatePoints();
};

window.closeScoreModal = () => {
    const modal = document.getElementById('score-modal');
    modal.classList.add('hidden');
};


// --- Navigation Controller ---
const switchView = (viewName) => {
    if (currentUserRole === 'Leaderboard' && viewName !== 'leaderboard') {
        console.warn("Restricted view attempt:", viewName);
        return;
    }
    if (currentUserRole === 'Chest' && viewName !== 'chest') {
        console.warn("Restricted view attempt for Chest role:", viewName);
        return;
    }
    currentView = viewName;

    // Update Sidebar UI
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.nav === viewName);
    });

    // Show/Hide Panels
    const panels = ['registrations', 'leaderboard', 'whitelist', 'settings', 'review', 'dates', 'deleted', 'chest', 'appeals'];
    panels.forEach(p => {
        const el = document.getElementById(`panel-${p}`);
        if (el) {
            el.classList.toggle('hidden', p !== viewName);
            if (p === viewName) {
                // Add fade-in animation
                el.classList.remove('fade-in-anim'); // Reset animation
                void el.offsetWidth; // Trigger reflow
                el.classList.add('fade-in-anim');
            }
        }
    });

    // Update Header Title
    const titles = {
        registrations: 'Registrations',
        leaderboard: 'Live Leaderboard',
        whitelist: 'System Access Control',
        settings: 'Registration Controls',
        review: 'Registration Audit',
        dates: 'Competition Schedule',
        deleted: 'Recently Deleted',
        chest: 'Chest Numbers',

    };
    document.getElementById('current-view-title').textContent = titles[viewName] || 'Dashboard';

    // Refresh view-specific data
    if (viewName === 'leaderboard') renderLeaderboard();
    if (viewName === 'whitelist') {
        renderWhitelist();
    }
    if (viewName === 'review') renderReview();
    if (viewName === 'deleted') renderDeletedTable();
    if (viewName === 'dates') {
        if (Object.keys(programDates).length === 0) fetchProgramDates();
        else renderDatesPanel();
    }
    if (viewName === 'chest') refreshChestPanel();
    if (viewName === 'appeals') fetchAppeals();

};

// Init Sidebar Click Handlers
document.querySelectorAll('.nav-item[data-nav]').forEach(item => {
    item.addEventListener('click', () => switchView(item.dataset.nav));
});

// Tab switching in registrations
document.querySelectorAll('.btn-tab[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.btn-tab').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentRegTab = btn.dataset.tab;

        // Reset item filter when switching tabs as items will change
        currentFilters.item = '';
        const itemSelect = document.getElementById('filter-item');
        if (itemSelect) itemSelect.value = '';

        populateItemFilter();
        renderTable();
    });
});



window.submitScore = async () => {
    const dept = document.getElementById('score-dept-id').value;
    const pointsToAdd = parseInt(document.getElementById('score-points').value);
    const scoreType = document.getElementById('score-type').value;
    const position = document.getElementById('score-position').value;
    const participant = document.getElementById('score-participant').value;
    const item = document.getElementById('score-item').value;

    if (isNaN(pointsToAdd) || pointsToAdd <= 0) {
        alert("Please enter a valid number of points");
        return;
    }

    if (!participant || !item) {
        alert("Please fill in both the Name and Item/Program details");
        return;
    }

    const btn = document.getElementById('submit-score-btn');
    const originalText = btn.textContent;
    btn.textContent = "Processing...";
    btn.disabled = true;

    try {
        // Update leaderboard atomically - isolalated by year
        const leaderboardDocId = `${dept}_${systemYear}`;
        const docRef = doc(db, "leaderboard", leaderboardDocId);
        await setDoc(docRef, {
            score: increment(pointsToAdd),
            department: dept,
            academicYear: systemYear,
            lastUpdated: new Date().toISOString()
        }, { merge: true });

        // Update local state for immediate UI feedback
        const currentScore = leaderboardScores[dept] || 0;
        const newScore = currentScore + pointsToAdd;
        leaderboardScores[dept] = newScore;

        // Log the achievement
        const logData = {
            department: dept,
            points: pointsToAdd,
            type: scoreType,
            position: position,
            academicYear: systemYear,
            timestamp: new Date().toISOString(),
            participantName: participant,
            itemName: item
        };
        log("[Score] Submitting logData object:", logData);
        await addDoc(collection(db, "score_logs"), logData);

        log(`Added ${pointsToAdd} points to ${dept}. New score: ${newScore}`);

        closeScoreModal();
        renderLeaderboard();
        alert(`Successfully added ${pointsToAdd} points to ${dept}`);
    } catch (e) {
        log("Error saving score:", e);
        alert("Error saving: " + e.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
};

window.saveScore = async (dept) => {
    // Deprecated direct save, keeping empty for compatibility if needed
    console.log("Direct save is now replaced by openScoreModal");
};

// Analysis Chart Logic
let currentChart = null;

window.renderDatesPanel = () => {
    const tbody = document.getElementById('dates-body');
    const searchInput = document.getElementById('date-search');
    const categoryInput = document.getElementById('date-category-filter');
    const search = searchInput ? searchInput.value.toLowerCase().trim() : "";
    const categoryFilter = categoryInput ? categoryInput.value : "";
    if (!tbody) return;
    tbody.innerHTML = '';

    // Merge hardcoded programs with dynamic ones from programDates
    const dynamicPrograms = Object.keys(programDates).filter(p => !ALL_PROGRAMS.includes(p));
    const fullProgramList = [...new Set([...ALL_PROGRAMS, ...dynamicPrograms])].sort();

    let hasData = false;
    fullProgramList.forEach(prog => {
        const programData = programDates[prog];

        // Determine category for filtering
        let progCategory = "";
        if (ON_STAGE_EVENTS.includes(prog)) {
            progCategory = "On Stage";
        } else if (OFF_STAGE_EVENTS.includes(prog)) {
            progCategory = "Off Stage";
        } else if (programData && programData.category) {
            progCategory = programData.category;
        }

        if (search && !prog.toLowerCase().includes(search)) return;
        if (categoryFilter && progCategory !== categoryFilter) return;

        hasData = true;

        const currentDate = programData?.date || "";
        const currentStage = programData?.stage || "";
        const tr = document.createElement('tr');
        tr.innerHTML = `
                    <td style="font-weight: 500;">
                        ${prog}
                        <div style="font-size: 0.7rem; color: var(--text-muted); font-weight: 400;">${progCategory}</div>
                    </td>
                    <td>
                        <input type="text" id="date-input-${prog.replace(/[^a-zA-Z0-9]/g, '_')}" 
                            class="input-pill" 
                            style="padding: 0.5rem 1rem; font-size: 0.85rem; width: 180px;"
                            placeholder="e.g. Jan 15, 10:00 AM"
                            value="${currentDate}">
                    </td>
                    <td>
                        <input type="text" id="stage-input-${prog.replace(/[^a-zA-Z0-9]/g, '_')}" 
                            class="input-pill" 
                            style="padding: 0.5rem 1rem; font-size: 0.85rem; width: 120px;"
                            placeholder="e.g. Stage 1"
                            value="${currentStage}">
                    </td>
                    <td>
                        <div style="display: flex; gap: 0.25rem;">
                            <button onclick="saveDate('${prog.replace(/'/g, "\\'")}')" 
                                class="btn-tab"
                                style="background: var(--accent-primary); color: white; border: none; padding: 0.5rem 0.75rem; font-size: 0.8rem; flex: 1;">
                                Save
                            </button>
                            <button onclick="deleteProgram('${prog.replace(/'/g, "\\'")}')" 
                                class="btn-tab"
                                title="Remove from Schedule"
                                style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); padding: 0.5rem 0.75rem; font-size: 0.8rem;">
                                <i class="fas fa-trash-alt"></i>
                            </button>
                        </div>
                    </td>
                `;
        tbody.appendChild(tr);
    });

    const noDataMsg = document.getElementById('no-dates-msg');
    if (noDataMsg) {
        if (!hasData) noDataMsg.classList.remove('hidden');
        else noDataMsg.classList.add('hidden');
    }
};

window.populateDefaultSchedule = async () => {
    if (!confirm("This will overwrite existing schedule data for the matching programs. Continue?")) return;

    const btn = document.getElementById('btn-populate-schedule');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Populating...';
    }

    const defaultData = {
        // DAY 1 : 16/01/2026
        "Story Writing (Malayalam)": { date: "Jan 16, 10:00 AM", stage: "Chithrashala" },
        "Essay Writing (Tamil)": { date: "Jan 16, 10:00 AM", stage: "Library" },
        "Aksharashlokam": { date: "Jan 16, 10:00 AM", stage: "1st Year BBA 215" },
        "Essay Writing (Urdu)": { date: "Jan 16, 11:00 AM", stage: "Library" },
        "Collage": { date: "Jan 16, 11:00 AM", stage: "1st Year BBA 215" },
        "Story Writing (Arabic)": { date: "Jan 16, 02:00 PM", stage: "Chithrashala" },
        "Story Writing (Tamil)": { date: "Jan 16, 02:00 PM", stage: "Library" },
        "Poster Making": { date: "Jan 16, 02:00 PM", stage: "1st Year BBA 215" },
        "Story Writing (Urdu)": { date: "Jan 16, 02:00 PM", stage: "Msc Biochemistry 2nd year 201" },
        "Extempore (Hindi)": { date: "Jan 16, 03:00 PM", stage: "Chithrashala" },
        "Extempore (English)": { date: "Jan 16, 03:00 PM", stage: "Chithrashala" },
        "Versification (Urdu)": { date: "Jan 16, 03:00 PM", stage: "Msc Biochemistry 2nd year 201" },

        // DAY 2 : 17/01/2026
        "Versification (Malayalam)": { date: "Jan 17, 10:00 AM", stage: "Chithrashala" },
        "Water Colour": { date: "Jan 17, 10:00 AM", stage: "1st Year BBA 215" },
        "Versification (Hindi)": { date: "Jan 17, 10:00 AM", stage: "Library" },
        "Versification (Tamil)": { date: "Jan 17, 10:00 AM", stage: "Msc Biochemistry 2nd year 201" },
        "Essay Writing (Malayalam)": { date: "Jan 17, 12:00 PM", stage: "Library" },
        "Rangoli": { date: "Jan 17, 01:30 PM", stage: "Room No : 101 (Economics 1st Year)/M.COM" },
        "Story Writing (Hindi)": { date: "Jan 17, 02:00 PM", stage: "Chithrashala" },
        "Versification (English)": { date: "Jan 17, 03:00 PM", stage: "Chithrashala" },
        "Embroidery": { date: "Jan 17, 03:00 PM", stage: "1st Year BBA 215" },
        "Spot Photography": { date: "Jan 17, 11:00 AM", stage: "-" },

        // DAY 3 : 20/01/2026
        "Versification (Arabic)": { date: "Jan 20, 10:00 AM", stage: "Library" },
        "Kavyakeli": { date: "Jan 20, 12:00 PM", stage: "Chithrashala" },
        "Pencil Drawing": { date: "Jan 20, 12:00 PM", stage: "Library" },
        "Essay Writing (Arabic)": { date: "Jan 20, 01:00 PM", stage: "Chithrashala" },
        "Cartoon Drawing": { date: "Jan 20, 01:00 PM", stage: "Library" },
        "Essay Writing (English)": { date: "Jan 20, 02:00 PM", stage: "Chithrashala" },
        "Oil Colour": { date: "Jan 20, 02:00 PM", stage: "Library" },
        "Essay Writing (Hindi)": { date: "Jan 20, 02:00 PM", stage: "1st Year BBA 215" },
        "Extempore (Malayalam)": { date: "Jan 20, 03:00 PM", stage: "Chithrashala" },
        "Story Writing (English)": { date: "Jan 20, 03:00 PM", stage: "Library" },
        "Clay Modeling": { date: "Jan 20, 10:00 AM", stage: "Amphitheatre" },

        // DAY 4 : 21/01/2026
        "Poem Recitation (Hindi)": { date: "Jan 21, 12:00 PM", stage: "FOCUS HALL" },
        "Poem Recitation (Malayalam)": { date: "Jan 21, 12:30 PM", stage: "FOCUS HALL" },
        "Light Music Girls": { date: "Jan 21, 02:00 PM", stage: "FOCUS HALL" },
        "Poem Recitation (Tamil)": { date: "Jan 21, 03:00 PM", stage: "FOCUS HALL" },
        "Light Music Boys": { date: "Jan 21, 12:00 PM", stage: "CHITHRASALA" },
        "Western Song": { date: "Jan 21, 12:30 PM", stage: "CHITHRASALA" },
        "Monoact": { date: "Jan 21, 02:00 PM", stage: "CHITHRASALA" },
        "Poem Recitation (English)": { date: "Jan 21, 03:00 PM", stage: "CHITHRASALA" },
        "Mappila Pattu Girls": { date: "Jan 21, 12:00 PM", stage: "ECONOMICS 101" },
        "Mappila Pattu Boys": { date: "Jan 21, 12:30 PM", stage: "ECONOMICS 101" },

        // DAY 5 : 22/01/2026 (From Image)
        "Vattapatt": { date: "Jan 22, 10:00 AM", stage: "MAIN STAGE" },
        "Margamkali": { date: "Jan 22, 12:00 PM", stage: "MAIN STAGE" },
        "Mime": { date: "Jan 22, 01:00 PM", stage: "MAIN STAGE" },
        "Drama": { date: "Jan 22, 02:45 PM", stage: "MAIN STAGE" },

        "Mappila Paattu Group": { date: "Jan 22, 10:00 AM", stage: "FOCUS HALL" },
        "Folk Music Group": { date: "Jan 22, 11:30 AM", stage: "FOCUS HALL" }, // Nadanpattu Group
        "Skit": { date: "Jan 22, 01:00 PM", stage: "FOCUS HALL" },
        "Ganamela": { date: "Jan 22, 02:00 PM", stage: "FOCUS HALL" },

        "Kadha Presangam": { date: "Jan 22, 10:00 AM", stage: "CHITRASALA" }, // Kathaprasangam
        "Classical Music Boys": { date: "Jan 22, 11:30 AM", stage: "CHITRASALA" },
        "Classical Music Girls": { date: "Jan 22, 11:30 AM", stage: "CHITRASALA" },

        // DAY 3 : 23/01/2026 (From Image)
        "Folk Dance Boys": { date: "Jan 23, 10:00 AM", stage: "MAIN STAGE" },
        "Folk Dance Girls": { date: "Jan 23, 10:00 AM", stage: "MAIN STAGE" },
        "Thiruvathira": { date: "Jan 23, 10:40 AM", stage: "MAIN STAGE" },
        "Oppana": { date: "Jan 23, 12:00 PM", stage: "MAIN STAGE" },
        "Folk Dance Group": { date: "Jan 23, 02:00 PM", stage: "MAIN STAGE" },

        "Patriotic Song Group": { date: "Jan 23, 10:00 AM", stage: "FOCUS HALL" },
        "Group Song (Western)": { date: "Jan 23, 11:30 AM", stage: "FOCUS HALL" },
        "Group Song (Indian)": { date: "Jan 23, 12:30 PM", stage: "FOCUS HALL" }
    };

    try {
        const batch = [];
        for (const prog in defaultData) {
            const dateDocId = `${prog}_${systemYear}`;
            batch.push(setDoc(doc(db, "program_dates", dateDocId), {
                ...defaultData[prog],
                programName: prog,
                academicYear: systemYear,
                updatedAt: new Date().toISOString()
            }, { merge: true }));
        }
        await Promise.all(batch);
        alert("Schedule populated successfully!");
        fetchProgramDates();
    } catch (error) {
        log("Error populating schedule:", error);
        alert("Failed to populate schedule: " + error.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-magic"></i> Populate Default Schedule';
        }
    }
};

window.openAddProgramModal = () => {
    const modal = document.getElementById('modal-add-program');
    if (modal) {
        modal.classList.remove('hidden');
        modal.style.display = 'flex';
        document.getElementById('new-program-name').value = '';
        document.getElementById('new-program-name').focus();
    }
};

window.closeAddProgramModal = () => {
    const modal = document.getElementById('modal-add-program');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
    }
};

window.addNewProgram = async () => {
    const nameInput = document.getElementById('new-program-name');
    const categoryInput = document.getElementById('new-program-category');
    const programName = nameInput.value.trim();
    const category = categoryInput.value;

    if (!programName) {
        alert("Please enter a program name.");
        return;
    }

    // Check if already exists in either hardcoded or dynamic list
    if (ALL_PROGRAMS.includes(programName) || programDates[programName]) {
        alert("This program already exists.");
        return;
    }

    try {
        const dateDocId = `${programName}_${systemYear}`;
        const newProgramData = {
            programName: programName,
            category: category,
            academicYear: systemYear,
            date: "",
            stage: "",
            updatedAt: new Date().toISOString(),
            isCustom: true
        };

        await setDoc(doc(db, "program_dates", dateDocId), newProgramData);

        // Update local state immediately
        programDates[programName] = newProgramData;

        log(`New program added: ${programName}`);
        closeAddProgramModal();
        renderDatesPanel();
        alert(`Successfully added "${programName}"`);
    } catch (e) {
        log("Error adding new program:", e);
        alert("Failed to add program: " + e.message);
    }
};

window.fetchProgramDates = async () => {
    log("Fetching program dates...");
    try {
        const q = query(collection(db, "program_dates"), where("academicYear", "==", systemYear));
        const querySnapshot = await getDocs(q);
        programDates = {};
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            programDates[data.programName] = data;
        });
        log("Program dates fetched:", programDates);
        if (currentView === 'dates') renderDatesPanel();
    } catch (error) {
        log("Error fetching dates:", error);
    }
};

window.saveDate = async (programName) => {
    const inputId = `date-input-${programName.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const input = document.getElementById(inputId);
    if (!input) return;

    const newDate = input.value.trim();
    const stageInputId = `stage-input-${programName.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const stageInput = document.getElementById(stageInputId);
    const newStage = stageInput ? stageInput.value.trim() : "";

    // Visual feedback on button
    const tr = input.closest('tr');
    const btn = tr ? tr.querySelector('button') : null;
    const originalText = btn ? btn.textContent : "Save";

    if (btn) {
        btn.textContent = "Saving...";
        btn.disabled = true;
    }

    try {
        const dateDocId = `${programName}_${systemYear}`;
        const programData = programDates[programName] || {};

        // Determine category if not already present in Firestore doc
        let category = programData.category || "";
        if (!category) {
            if (ON_STAGE_EVENTS.includes(programName)) category = "On Stage";
            else if (OFF_STAGE_EVENTS.includes(programName)) category = "Off Stage";
        }

        await setDoc(doc(db, "program_dates", dateDocId), {
            programName: programName,
            date: newDate,
            stage: newStage,
            category: category,
            academicYear: systemYear,
            updatedAt: new Date().toISOString()
        }, { merge: true });

        programDates[programName] = { ...programData, date: newDate, stage: newStage, category: category };
        log(`Date saved for ${programName}: ${newDate}`);

        if (btn) {
            btn.textContent = "Saved!";
            btn.style.background = "var(--success)";
            setTimeout(() => {
                btn.textContent = "Save";
                btn.style.background = "var(--accent-primary)";
                btn.disabled = false;
            }, 2000);
        }
    } catch (error) {
        log("Error saving date:", error);
        alert("Failed to save date: " + error.message);
        if (btn) {
            btn.textContent = "Retry";
            btn.style.background = "var(--error)";
            btn.disabled = false;
        }
    }
};

window.deleteProgram = async (programName) => {
    if (!confirm(`Are you sure you want to remove "${programName}" from the ${systemYear} schedule?`)) return;

    try {
        const dateDocId = `${programName}_${systemYear}`;
        const programDocRef = doc(db, "program_dates", dateDocId);

        // Check if it's a custom program
        const isCustom = !ALL_PROGRAMS.includes(programName);

        if (isCustom) {
            // Fully delete custom programs from the year
            await deleteDoc(programDocRef);
            delete programDates[programName];
            log(`Custom program deleted: ${programName}`);
        } else {
            // For hardcoded programs, just clear the date/stage data in Firestore
            await setDoc(programDocRef, {
                programName: programName,
                date: "",
                stage: "",
                updatedAt: new Date().toISOString()
            }, { merge: true });

            if (programDates[programName]) {
                programDates[programName].date = "";
                programDates[programName].stage = "";
            }
            log(`Schedule cleared for hardcoded program: ${programName}`);
        }

        renderDatesPanel();
        if (window.showToast) showToast("Program Removed", `"${programName}" has been removed/cleared from the schedule.`, "info");
    } catch (e) {
        log("Error deleting program:", e);
        alert("Failed to delete program: " + e.message);
    }
};

window.openAnalysisModal = async (dept) => {
    const modal = document.getElementById('analysis-modal');
    const deptDisplay = document.getElementById('analysis-dept');
    const loader = document.getElementById('chart-loader');
    const noData = document.getElementById('chart-no-data');
    const canvas = document.getElementById('scoreChart');

    deptDisplay.textContent = dept;
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    // UI Reset
    canvas.style.display = 'none';
    noData.style.display = 'none';
    loader.style.display = 'block';

    if (currentChart) {
        currentChart.destroy();
        currentChart = null;
    }

    try {
        log(`[Analysis] Opening for: ${dept}`);
        const q = query(
            collection(db, "score_logs"),
            where("department", "==", dept),
            where("academicYear", "==", systemYear),
            orderBy("timestamp", "desc")
        );

        let querySnapshot;
        try {
            querySnapshot = await getDocs(q);
            log(`[Analysis] Query successful via primary index. Found: ${querySnapshot.size} total docs`);
        } catch (err) {
            log("[Analysis] Primary query failed (index issue?), falling back to filtered getDocs...", err);
            querySnapshot = await getDocs(query(collection(db, "score_logs"), where("department", "==", dept), where("academicYear", "==", systemYear)));
            log(`[Analysis] Fallback query complete. Found: ${querySnapshot.size} docs`);
        }

        if (querySnapshot.empty) {
            log(`[Analysis] No docs found for department: ${dept}`);
            loader.style.display = 'none';
            noData.style.display = 'block';
            return;
        }

        const dataMap = {};
        const historyList = document.getElementById('score-history-list');
        historyList.innerHTML = '';
        let validMatchCount = 0;

        querySnapshot.forEach(doc => {
            const logData = doc.data();
            const logId = doc.id;
            const logDept = logData.department;
            log(`[Analysis] Inspecting log: ${logId} | Dept: ${logDept} | Item: ${logData.itemName} | Pts: ${logData.points}`);

            // ROBUSTNESS: Explicit manual check to ensure we don't "leak" logs from other depts
            if (logDept !== dept) {
                log(`[Analysis] !! FILTERED OUT !! Expected ${dept}, found ${logDept}`, logData);
                return;
            }
            log(`[Analysis] >> MATCHED << Including log for ${dept}`);

            validMatchCount++;
            const item = logData.itemName || "Other";
            const pts = logData.points || 0;

            if (validMatchCount <= 100) { // Limit UI items for performance
                dataMap[item] = (dataMap[item] || 0) + pts;

                // Add to history list UI
                const histItem = document.createElement('div');
                histItem.className = 'history-item';
                histItem.style.cssText = "background: rgba(255,255,255,0.03); padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--glass-border); display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: var(--transition-smooth); margin-bottom: 0.5rem;";
                histItem.onmouseover = () => histItem.style.background = "rgba(255,255,255,0.06)";
                histItem.onmouseout = () => histItem.style.background = "rgba(255,255,255,0.03)";

                const dateStr = logData.timestamp ? new Date(logData.timestamp).toLocaleDateString() : '';

                histItem.innerHTML = `
                            <div onclick='showScoreLogDetails(${JSON.stringify(logData).split("'").join("&apos;")})' style="flex-grow: 1;">
                                <div style="font-weight: 700; font-size: 0.95rem; color: var(--accent-secondary);">${pts > 0 ? '+' : ''}${pts} Points</div>
                                <div style="font-size: 0.75rem; color: var(--text-main); font-weight: 500;">${item}</div>
                                <div style="font-size: 0.7rem; color: var(--text-muted);">${logData.participantName || 'N/A'} • ${dateStr}</div>
                            </div>
                            <button onclick="event.stopPropagation(); deleteScoreLog('${logId}', ${pts}, '${dept}')" 
                                style="background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.2); color: #ef4444; padding: 0.5rem 0.85rem; border-radius: 0.5rem; cursor: pointer; font-size: 0.75rem; font-weight: 600; transition: var(--transition-smooth); margin-left: 1rem;">
                                <i class="fas fa-trash-alt"></i> Delete
                            </button>
                        `;
                historyList.appendChild(histItem);
            }
        });

        log(`[Analysis] Finished processing. Valid matches: ${validMatchCount}`);

        if (validMatchCount === 0) {
            loader.style.display = 'none';
            noData.style.display = 'block';
            return;
        }

        loader.style.display = 'none';
        canvas.style.display = 'block';

        const ctx = canvas.getContext('2d');
        currentChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: Object.keys(dataMap),
                datasets: [{
                    data: Object.values(dataMap),
                    backgroundColor: [
                        '#f472b6', '#a78bfa', '#22d3ee', '#34d399', '#fbbf24', '#f87171', '#60a5fa'
                    ],
                    borderWidth: 0,
                    hoverOffset: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#cbd5e1',
                            font: { family: 'Inter', size: 11 },
                            padding: 20
                        }
                    }
                }
            }
        });

    } catch (e) {
        log("Error loading analysis data:", e);
        loader.textContent = "Error loading charts.";
    }
};

window.closeAnalysisModal = () => {
    const modal = document.getElementById('analysis-modal');
    modal.classList.add('hidden');
    if (currentChart) {
        currentChart.destroy();
        currentChart = null;
    }
};

window.deleteScoreLog = async (logId, points, dept) => {
    if (!confirm(`Are you sure you want to remove these ${points} points? This will also update the department's total score.`)) return;

    try {
        log(`Removing ${points} points from ${dept}...`);

        // Update leaderboard atomically
        const leaderboardDocId = `${dept}_${systemYear}`;
        await updateDoc(doc(db, "leaderboard", leaderboardDocId), {
            score: increment(-points),
            lastUpdated: new Date().toISOString()
        });

        await deleteDoc(doc(db, "score_logs", logId));

        const currentTotal = leaderboardScores[dept] || 0;
        const newTotal = Math.max(0, currentTotal - points);
        leaderboardScores[dept] = newTotal;

        log(`Success: Points removed. New total for ${dept}: ${newTotal}`);
        renderLeaderboard();
        openAnalysisModal(dept);
        alert("Points removed and leaderboard updated successfully.");
    } catch (e) {
        log("Error deleting score log:", e);
        alert("Error removing points: " + e.message);
    }
};

window.recalculateLeaderboard = async () => {
    if (!confirm("This will scan all score logs and rebuild the department totals from scratch. This can fix inconsistencies but may take a few moments. Proceed?")) return;

    log("Starting leaderboard recalculation...");
    const btn = document.querySelector('button[onclick="recalculateLeaderboard()"]');
    const originalHTML = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';

    try {
        // 1. Fetch score logs for the CURRENT system year only
        const logsQuery = query(collection(db, "score_logs"), where("academicYear", "==", systemYear));
        const logsSnap = await getDocs(logsQuery);
        log(`Fetched ${logsSnap.size} score logs for year ${systemYear}.`);

        const totals = {};
        DEPARTMENTS.forEach(d => totals[d] = 0);

        logsSnap.forEach(doc => {
            const data = doc.data();
            const dept = data.department;
            const pts = parseInt(data.points) || 0;
            if (dept && totals.hasOwnProperty(dept)) {
                totals[dept] += pts;
            }
        });

        log("New totals calculated:", totals);

        // 2. Update leaderboard collection for each department
        const promises = Object.keys(totals).map(dept => {
            const leaderboardDocId = `${dept}_${systemYear}`;
            return setDoc(doc(db, "leaderboard", leaderboardDocId), {
                score: totals[dept],
                department: dept,
                academicYear: systemYear,
                lastUpdated: new Date().toISOString()
            }, { merge: true });
        });

        await Promise.all(promises);
        log("Leaderboard successfully rebuilt.");

        // 3. Update local state and UI
        leaderboardScores = totals;
        renderLeaderboard();
        alert("Leaderboard scores have been recalculated and synchronized successfully.");

    } catch (error) {
        log("Error during recalculation:", error);
        alert("Recalculation failed: " + error.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
};


window.showScoreLogDetails = (data) => {
    const modal = document.getElementById('score-detail-modal');
    const content = document.getElementById('score-detail-content');
    const date = data.timestamp ? new Date(data.timestamp).toLocaleString() : 'Date Unknown';

    content.innerHTML = `
                <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 0.5rem;">
                    <span style="display: block; font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase;">Points Granted</span>
                    <strong style="font-size: 1.5rem; color: var(--accent-color);">+${data.points || 0}</strong>
                </div>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <div>
                        <span style="display: block; font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase;">Scorer Type</span>
                        <span style="font-size: 0.9rem;">${data.type === 'individual' ? '🥇 Individual' : '👥 Department/Group'}</span>
                    </div>
                    <div>
                        <span style="display: block; font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase;">Position</span>
                        <span style="font-size: 0.9rem; font-weight: 700; color: ${data.position !== 'None' ? 'var(--accent-color)' : 'inherit'}">${data.position || 'None'}</span>
                    </div>
                </div>
                <div>
                    <span style="display: block; font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase;">Date & Time</span>
                    <span style="font-size: 0.9rem;">${date}</span>
                </div>
                <div>
                    <span style="display: block; font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase;">Department</span>
                    <span style="font-size: 0.9rem;">${data.department || 'N/A'}</span>
                </div>
                <div>
                    <span style="display: block; font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase;">Item / Program</span>
                    <span style="font-size: 0.9rem; font-weight: 600;">${data.itemName || 'N/A'}</span>
                </div>
                <div>
                    <span style="display: block; font-size: 0.7rem; color: var(--text-secondary); text-transform: uppercase;">Participant / Leader</span>
                    <span style="font-size: 0.9rem; font-weight: 600;">${data.participantName || 'N/A'}</span>
                </div>
            `;
    modal.style.display = 'flex';
};

window.closeScoreDetailModal = () => {
    document.getElementById('score-detail-modal').classList.add('hidden');
};

const fetchRegistrations = async () => {
    log("Fetching registrations...");
    if (loadingInd) loadingInd.style.display = 'block';
    if (regBody) regBody.innerHTML = '';
    if (noDataMsg) noDataMsg.style.display = 'none';

    try {
        // Fetch registrations based on user permissions AND academic year
        let q;
        const baseCollection = collection(db, "registrations");
        if (currentUserRole === 'Admin' || currentUserRole === 'Main' || currentUserRole === 'Chest') {
            q = query(baseCollection, where("academicYear", "==", systemYear));
        } else if (currentUserDept && currentUserAllowedCourses.length > 0) {
            log(`Department Accessor (${currentUserDept}): Fetching filtered registrations for ${systemYear}`);
            q = query(
                baseCollection,
                where("academicYear", "==", systemYear),
                where("department", "in", currentUserAllowedCourses)
            );
        } else {
            log("Standard User/Unauthorized: Limited fetch");
            q = query(baseCollection, where("academicYear", "==", systemYear), limit(1));
        }
        const querySnapshot = await getDocs(q);

        log(`Query complete. Found ${querySnapshot.size} documents.`);

        allRegistrations = [];
        querySnapshot.forEach((doc) => {
            const data = doc.data();
            allRegistrations.push({ id: doc.id, ...data });
        });

        if (allRegistrations.length > 0) {
            log("First document sample:", allRegistrations[0]);
        } else {
            log("No documents found in 'registrations' collection.");
        }

        // Sort by date (newest first) client-side
        allRegistrations.sort((a, b) => {
            const dateA = a.registeredAt ? new Date(a.registeredAt) : new Date(0);
            const dateB = b.registeredAt ? new Date(b.registeredAt) : new Date(0);
            return dateB - dateA;
        });

        // Ensure program dates are loaded for the schedule column
        if (Object.keys(programDates).length === 0) {
            await fetchProgramDates();
        }

        populateItemFilter();
        renderTable();
        updateReviewCount();
        if (window.refreshChestPanel) {
            window.refreshChestPanel();
        }
    } catch (error) {
        log("Error fetching registrations:", error);
        console.error("fetchRegistrations Error:", error);
        if (loadingInd) loadingInd.textContent = "Error loading data: " + error.message;
    } finally {
        if (loadingInd) loadingInd.style.display = 'none';
    }
};
window.fetchRegistrations = fetchRegistrations;


const refreshAll = async () => {
    const tasks = [fetchLeaderboard(), fetchRegistrations()];
    if (currentUserRole !== 'Leaderboard') {
        tasks.push(fetchWhitelist(), fetchSettings(), fetchNews());
    }
    await Promise.all(tasks);
};
window.refreshAll = refreshAll;



// --- Listeners and Init ---



const refreshBtn = document.getElementById('refresh-btn');
if (refreshBtn) {
    refreshBtn.addEventListener('click', refreshAll);
}

const addToWhitelistBtn = document.getElementById('add-to-whitelist-btn');
if (addToWhitelistBtn) {
    addToWhitelistBtn.addEventListener('click', addToWhitelist);
}

// Whitelist Role Change Listener
const newWhitelistRole = document.getElementById('new-whitelist-role');
const newWhitelistDept = document.getElementById('new-whitelist-dept');
if (newWhitelistRole && newWhitelistDept) {
    newWhitelistRole.addEventListener('change', (e) => {
        const deptGroup = newWhitelistDept.closest('.filter-group');
        if (e.target.value === 'Leaderboard' || e.target.value === 'Chest') {
            if (deptGroup) deptGroup.style.opacity = '0.3';
            newWhitelistDept.disabled = true;
            newWhitelistDept.value = ''; // Reset
        } else {
            if (deptGroup) deptGroup.style.opacity = '1';
            newWhitelistDept.disabled = false;
        }
    });
}

// Filter Event Listeners
const resetFilters = (shouldRender = true) => {
    currentFilters = { search: '', dept: '', year: '', item: '', regType: '' };
    const sInput = document.getElementById('filter-search');
    const dInput = document.getElementById('filter-dept');
    const yInput = document.getElementById('filter-year');
    const iInput = document.getElementById('filter-item');
    const tInput = document.getElementById('filter-type');
    if (sInput) sInput.value = '';
    if (dInput) dInput.value = '';
    if (yInput) yInput.value = '';
    if (iInput) iInput.value = '';
    if (tInput) tInput.value = '';
    if (shouldRender) renderTable();
};
window.resetFilters = resetFilters;

const filterSearch = document.getElementById('filter-search');
if (filterSearch) {
    filterSearch.addEventListener('input', (e) => {
        currentFilters.search = e.target.value;
        renderTable();
    });
}

const filterDept = document.getElementById('filter-dept');
if (filterDept) {
    filterDept.addEventListener('change', (e) => {
        currentFilters.dept = e.target.value;
        renderTable();
    });
}

const filterYear = document.getElementById('filter-year');
if (filterYear) {
    filterYear.addEventListener('change', (e) => {
        currentFilters.year = e.target.value;
        renderTable();
    });
}

const filterItem = document.getElementById('filter-item');
if (filterItem) {
    filterItem.addEventListener('change', (e) => {
        currentFilters.item = e.target.value;
        renderTable();
    });
}

const filterTypeDropdown = document.getElementById('filter-type');
if (filterTypeDropdown) {
    filterTypeDropdown.addEventListener('change', (e) => {
        currentFilters.regType = e.target.value;
        renderTable();
    });
}

const clearFiltersBtn = document.getElementById('clear-filters-btn');
if (clearFiltersBtn) {
    clearFiltersBtn.addEventListener('click', () => resetFilters(true));
}

// Edit Modal Logic
const editModal = document.getElementById('edit-modal');
const editIdInput = document.getElementById('edit-id');
const editNameInput = document.getElementById('edit-name');
const editCategoryInput = document.getElementById('edit-category');
const editRollInput = document.getElementById('edit-roll');
const editYearInput = document.getElementById('edit-year');
const editProgramInput = document.getElementById('edit-program');

window.closeViewRegModal = () => {
    document.getElementById('view-reg-modal').classList.add('hidden');
    document.getElementById('view-reg-modal').style.display = 'none';
};

window.viewRegistration = (id) => {
    const student = allRegistrations.find(r => r.id === id);
    if (!student) return;

    const content = document.getElementById('view-reg-content');
    const date = student.registeredAt ? new Date(student.registeredAt).toLocaleString() : 'N/A';

    let membersHtml = '';
    if (student.regType === 'Group' && student.groupMembers && student.groupMembers.length > 0) {
        membersHtml = `
                    <div style="margin-top: 1rem;">
                        <span style="display: block; font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem;">Group Members (${student.groupMembers.length})</span>
                        <div style="display: grid; gap: 0.5rem; background: rgba(255,255,255,0.03); border-radius: 0.75rem; border: 1px solid var(--glass-border); padding: 1rem;">
                            ${student.groupMembers.map((m, i) => {
            const mYearText = m.year === "1" ? "1st Yr" : m.year === "2" ? "2nd Yr" : m.year === "3" ? "3rd Yr" : m.year === "4" ? "4th Yr" : (m.year ? `${m.year} Yr` : '');
            return `
                                <div style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 0.5rem; border-bottom: ${i === student.groupMembers.length - 1 ? 'none' : '1px solid rgba(255,255,255,0.05)'}; margin-bottom: ${i === student.groupMembers.length - 1 ? '0' : '0.5rem'};">
                                    <span style="font-weight: 500; text-transform: uppercase; font-size: 0.85rem;">${escapeHtml(m.name)} ${mYearText ? `<span style="color: var(--accent-secondary); font-size: 0.75rem; margin-left: 0.5rem;">[${escapeHtml(mYearText)}]</span>` : ''}</span>
                                    <code style="font-size: 0.75rem; color: var(--accent-primary);">${escapeHtml(m.roll || '-')}</code>
                                </div>
                                `;
        }).join('')}
                        </div>
                    </div>
                `;
    }

    content.innerHTML = `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1.5rem;">
                    <div style="background: rgba(255,255,255,0.03); padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--glass-border);">
                        <span style="display: block; font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Student / Group Name</span>
                        <strong style="font-size: 1.1rem; color: #fff;">${student.regType === 'Group' ? escapeHtml(student.groupName || student.studentName || '-') : escapeHtml(student.studentName || '-')}</strong>
                        ${(student.regType === 'Group' && student.groupName && student.studentName) ? `<div style="color: var(--accent-secondary); font-size: 0.85rem; font-weight: 700; margin-top: 0.25rem;">Leader: ${escapeHtml(student.studentName)}</div>` : ''}
                        ${(student.regType !== 'Group' && student.groupName) ? `<div style="color: var(--accent-secondary); font-size: 0.85rem; font-weight: 700; margin-top: 0.25rem;">${escapeHtml(student.groupName)}</div>` : ''}
                    </div>
                    <div style="background: rgba(255,255,255,0.03); padding: 1rem; border-radius: 0.75rem; border: 1px solid var(--glass-border);">
                        <span style="display: block; font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Program / Item</span>
                        <strong style="font-size: 1.1rem; color: var(--accent-primary);">${escapeHtml(student.program || '-')}</strong>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem;">
                    <div>
                        <span style="display: block; font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Department</span>
                        <span style="font-size: 0.9rem;">${escapeHtml(student.department || '-')}</span>
                    </div>
                    <div>
                        <span style="display: block; font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Year</span>
                        <span style="font-size: 0.9rem;">${escapeHtml(student.year || '-')}</span>
                    </div>
                    <div>
                        <span style="display: block; font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Roll Number</span>
                        <code style="font-size: 0.9rem; color: var(--accent-primary);">${escapeHtml(student.rollNumber || '-')}</code>
                    </div>
                </div>

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                    <div>
                        <span style="display: block; font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Category</span>
                        <span class="badge" style="background: rgba(99, 102, 241, 0.1); color: var(--accent-primary);">${escapeHtml(student.category || '-')}</span>
                    </div>
                    <div>
                        <span style="display: block; font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Reg Type</span>
                        <span class="badge" style="background: ${student.regType === 'Group' ? 'rgba(217, 70, 239, 0.1)' : 'rgba(99, 102, 241, 0.1)'}; color: ${student.regType === 'Group' ? 'var(--accent-secondary)' : 'var(--accent-primary)'};">${escapeHtml(student.regType || '-')}</span>
                    </div>
                </div>

                ${membersHtml}

                				<div style="border-top: 1px solid var(--glass-border); padding-top: 1rem; display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
					<div>
						<span style="display: block; font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Schedule</span>
						${(() => {
            const pData = programDates[student.program];
            if (!pData) return '<span style="font-size: 0.85rem; opacity: 0.7">Not Scheduled</span>';
            return `
								<span style="display: block; font-size: 0.9rem; font-weight: 600; color: var(--accent-primary);">${pData.date || '-'}</span>
								<span style="display: block; font-size: 0.8rem; color: var(--text-muted);">${pData.stage || '-'}</span>
							`;
        })()}
					</div>
					<div style="text-align: right;">
						<span style="display: block; font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase;">Time Stamp</span>
						<span style="font-size: 0.85rem; color: var(--text-muted);">${date}</span>
					</div>
				</div>
            `;

    const editBtn = document.getElementById('view-reg-edit-btn');
    editBtn.onclick = () => {
        closeViewRegModal();
        openEditModal(id);
    };

    const modal = document.getElementById('view-reg-modal');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';
};

window.toggleEditGroupField = () => {
    const type = document.getElementById('edit-type').value;
    const container = document.getElementById('edit-group-container');
    const rollContainer = document.getElementById('edit-roll-container');
    if (type === 'Group') {
        if (container) container.classList.remove('hidden');
        // Ensure rollContainer is also shown for groups as requested
        if (rollContainer) rollContainer.classList.remove('hidden');
    } else {
        if (container) container.classList.add('hidden');
        if (rollContainer) rollContainer.classList.remove('hidden');
    }
};

window.addEditMemberRow = (name = '', roll = '', year = '1') => {
    const list = document.getElementById('edit-members-list');
    if (!list) return;
    const div = document.createElement('div');
    div.style.display = 'flex';
    div.style.gap = '0.5rem';
    div.style.marginBottom = '0.5rem';
    div.innerHTML = `
                <input type="text" class="input-pill edit-member-name" placeholder="Name" value="${name}" style="flex: 2; padding: 0.4rem 0.8rem; font-size: 0.8rem; text-transform: uppercase;">
                <input type="text" class="input-pill edit-member-roll" placeholder="Roll No" value="${roll}" style="flex: 1; padding: 0.4rem 0.8rem; font-size: 0.8rem; text-transform: uppercase;">
                <input type="text" class="input-pill edit-member-year" placeholder="Year" value="${year}" style="flex: 1; padding: 0.4rem 0.8rem; font-size: 0.8rem; text-transform: uppercase;">
                <button type="button" class="logout-btn" onclick="this.parentElement.remove()" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: none; padding: 0; width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; cursor: pointer; border-radius: 0.5rem;">&times;</button>
            `;
    list.appendChild(div);
};

window.openEditModal = (id) => {
    const student = allRegistrations.find(r => r.id === id);
    if (!student) return;

    editIdInput.value = id;
    editNameInput.value = student.studentName || '';
    editCategoryInput.value = student.category || 'On Stage';
    editRollInput.value = student.rollNumber || '';
    editProgramInput.value = student.program || '';
    if (editYearInput) editYearInput.value = student.year || '1';

    const typeSelect = document.getElementById('edit-type');
    const groupInput = document.getElementById('edit-group-name');
    const membersList = document.getElementById('edit-members-list');

    if (typeSelect) typeSelect.value = student.regType || 'Individual';
    if (groupInput) groupInput.value = student.groupName || '';
    if (membersList) {
        membersList.innerHTML = '';
        if (student.groupMembers && Array.isArray(student.groupMembers)) {
            student.groupMembers.forEach(m => addEditMemberRow(m.name, m.roll, m.year));
        }
    }

    toggleEditGroupField();

    editModal.classList.remove('hidden');
    editModal.style.display = 'flex';
};

window.closeEditModal = () => {
    editModal.classList.add('hidden');
    editModal.style.display = 'none';
};

window.saveEdit = async () => {
    const id = editIdInput.value;
    const groupMembers = [];
    const memberRows = document.querySelectorAll('#edit-members-list > div');
    memberRows.forEach(row => {
        const mName = row.querySelector('.edit-member-name').value;
        const mRoll = row.querySelector('.edit-member-roll').value;
        const mYear = row.querySelector('.edit-member-year').value;
        if (mName) groupMembers.push({ name: mName, roll: mRoll, year: mYear });
    });

    const updates = {
        studentName: editNameInput.value,
        category: editCategoryInput.value,
        rollNumber: editRollInput.value,
        program: editProgramInput.value,
        year: editYearInput.value,
        regType: document.getElementById('edit-type').value,
        groupName: document.getElementById('edit-group-name').value,
        groupMembers: groupMembers
    };

    const btn = editModal.querySelector('button[onclick="saveEdit()"]');
    const originalText = btn.textContent;
    btn.textContent = "Saving...";
    btn.disabled = true;

    try {
        const docRef = doc(db, "registrations", id);
        await updateDoc(docRef, updates);

        // Close and refresh
        closeEditModal();
        fetchRegistrations();
        alert("Updated successfully");
    } catch (e) {
        console.error("Update Error:", e);
        alert("Failed to update: " + e.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
};

window.toggleCancelRegistration = async (id) => {
    const student = allRegistrations.find(r => r.id === id);
    if (!student) return;

    const newStatus = !student.isCanceled;
    const actionText = newStatus ? "cancel" : "restore";

    if (!confirm(`Are you sure you want to ${actionText} the registration for ${student.studentName}?`)) return;

    try {
        await updateDoc(doc(db, "registrations", id), { isCanceled: newStatus });
        log(`Registration ${id} ${newStatus ? 'canceled' : 'restored'} successfully.`);

        // Update local state and UI
        student.isCanceled = newStatus;
        renderTable();
        updateReviewCount();
        renderReview(); // Refresh background audit

        // If inspect modal is open, refresh it
        const inspectModal = document.getElementById('inspect-modal');
        if (inspectModal && !inspectModal.classList.contains('hidden')) {
            const title = document.getElementById('inspect-modal-title').textContent;
            // We need to re-find the relevant registrations based on the title context
            // For simplicity, let's just re-calculate based on what was being viewed
            if (window.currentInspectContext) {
                const { type, params } = window.currentInspectContext;
                if (type === 'student') window.viewStudentIssues(...params);
                else if (type === 'item') window.viewItemIssues(...params);
                else if (type === 'deptItem') window.viewDepartmentItemIssues(...params);
            }
        }
    } catch (e) {
        log("Toggle Cancel Error:", e);
        alert("Failed to update status: " + e.message);
    }
};

window.deleteRegistration = async (id, name) => {
    if (!confirm(`Are you sure you want to move the registration for "${name}" to trash?`)) return;

    log(`Moving registration for ${name} (ID: ${id}) to trash...`);
    try {
        await updateDoc(doc(db, "registrations", id), {
            isDeleted: true,
            deletedAt: new Date().toISOString()
        });
        log(`Registration ${id} moved to trash.`);

        // Update local state
        const student = allRegistrations.find(r => r.id === id);
        if (student) {
            student.isDeleted = true;
            student.deletedAt = new Date().toISOString();
        }

        renderTable();
        updateStats();
        alert(`Registration for "${name}" has been moved to trash.`);
    } catch (e) {
        log("Trash Error:", e);
        alert("Failed to move to trash: " + e.message);
    }
};

window.renderDeletedTable = () => {
    const body = document.getElementById('deleted-registrations-body');
    const noMsg = document.getElementById('no-deleted-msg');
    if (!body) return;
    body.innerHTML = '';

    const deleted = allRegistrations.filter(r => r.isDeleted);

    if (deleted.length === 0) {
        if (noMsg) noMsg.classList.remove('hidden');
    } else {
        if (noMsg) noMsg.classList.add('hidden');
    }

    deleted.forEach(student => {
        const deletedAt = student.deletedAt ? new Date(student.deletedAt).toLocaleString() : 'N/A';
        const tr = document.createElement('tr');
        tr.innerHTML = `
                    <td>
                        <div style="font-weight: 600;">${student.regType === 'Group' ? escapeHtml(student.groupName || student.studentName || '-') : escapeHtml(student.studentName || '-')}</div>
                        <div style="font-size: 0.7rem; color: var(--text-muted);">${escapeHtml(student.phone || '-')}</div>
                    </td>
                    <td><span class="badge badge-dept">${(student.department || '-').replace('Dep. of ', '')}</span></td>
                    <td><code>${escapeHtml(student.rollNumber || '-')}</code></td>
                    <td><span class="badge" style="background: rgba(99, 102, 241, 0.1); color: var(--accent-primary);">${escapeHtml(student.regType || 'Individual')}</span></td>
                    <td><div style="font-weight: 500;">${escapeHtml(student.program || '-')}</div></td>
                    <td><span style="font-size: 0.8rem; color: var(--text-muted);">${deletedAt}</span></td>
                    <td>
                        <div style="display: flex; gap: 0.75rem;">
                            <button onclick="restoreRegistration('${student.id}', '${escapeHtml((student.studentName || 'Student').replace(/'/g, "\\'"))}')" title="Restore" class="btn-tab" style="background: rgba(16, 185, 129, 0.1); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.2);"><i class="fas fa-undo"></i> Restore</button>
                            <button onclick="permanentDeleteRegistration('${student.id}', '${escapeHtml((student.studentName || 'Student').replace(/'/g, "\\'"))}')" title="Delete Permanently" class="btn-tab" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2);"><i class="fas fa-times"></i> Delete</button>
                        </div>
                    </td>
                `;
        body.appendChild(tr);
    });
};

window.restoreRegistration = async (id, name) => {
    if (!confirm(`Are you sure you want to restore the registration for "${name}"?`)) return;

    log(`Restoring registration for ${name} (ID: ${id})...`);
    try {
        await updateDoc(doc(db, "registrations", id), {
            isDeleted: false,
            deletedAt: null
        });
        log(`Registration ${id} restored.`);

        // Update local state
        const student = allRegistrations.find(r => r.id === id);
        if (student) {
            student.isDeleted = false;
            student.deletedAt = null;
        }

        renderDeletedTable();
        updateStats();
        alert(`Registration for "${name}" has been restored.`);
    } catch (e) {
        log("Restore Error:", e);
        alert("Failed to restore: " + e.message);
    }
};

window.permanentDeleteRegistration = async (id, name) => {
    if (!confirm(`Are you sure you want to PERMANENTLY delete the registration for "${name}"? This action cannot be undone.`)) return;

    log(`Permanently deleting registration for ${name} (ID: ${id})...`);
    try {
        await deleteDoc(doc(db, "registrations", id));
        log(`Registration ${id} permanently deleted.`);

        // Remove from local array
        allRegistrations = allRegistrations.filter(r => r.id !== id);

        renderDeletedTable();
        updateStats();
        alert(`Registration for "${name}" has been permanently deleted.`);
    } catch (e) {
        log("Permanent Delete Error:", e);
        alert("Failed to delete registration: " + e.message);
    }
};

// --- Chest Numbers Logic ---
let currentChestRegistrations = [];

let chestSeriesConfigs = {};

window.refreshChestPanel = async () => {
    const select = document.getElementById('chest-item-select');
    if (!select) return;
    const currentVal = select.value;
    select.innerHTML = '<option value="">Choose an item...</option>';

    const activeItems = new Set();
    allRegistrations.forEach(r => {
        if (!r.isDeleted && r.program) activeItems.add(r.program);
    });

    Array.from(activeItems).sort().forEach(item => {
        const opt = document.createElement('option');
        opt.value = item;
        opt.textContent = item;
        select.appendChild(opt);
    });

    // Fetch series configs once
    try {
        const snap = await getDocs(collection(db, "chest_series_configs"));
        snap.forEach(doc => {
            chestSeriesConfigs[doc.id] = doc.data().seriesBase;
        });
    } catch (e) { log("Error fetching series configs:", e); }

    if (currentVal && activeItems.has(currentVal)) {
        select.value = currentVal;
        onChestProgramChange();
    } else {
        document.getElementById('chest-body').innerHTML = '';
        document.getElementById('no-chest-msg').classList.remove('hidden');
    }
};

window.onChestProgramChange = () => {
    const program = document.getElementById('chest-item-select').value;
    const seriesSelect = document.getElementById('chest-series-select');
    if (program && chestSeriesConfigs[program] !== undefined) {
        seriesSelect.value = chestSeriesConfigs[program];
    } else {
        seriesSelect.value = "0";
    }
    loadChestParticipants();
};

window.applyChestSeries = async () => {
    const program = document.getElementById('chest-item-select').value;
    const series = parseInt(document.getElementById('chest-series-select').value);
    if (!program) return;

    try {
        await setDoc(doc(db, "chest_series_configs", program), {
            seriesBase: series,
            updatedAt: serverTimestamp()
        });
        chestSeriesConfigs[program] = series;
        log(`Series base ${series} applied to ${program}`);
        loadChestParticipants();
    } catch (e) {
        log("Error saving series config:", e);
        alert("Failed to save series: " + e.message);
    }
};

window.loadChestParticipants = () => {
    const program = document.getElementById('chest-item-select').value;
    const body = document.getElementById('chest-body');
    const noMsg = document.getElementById('no-chest-msg');
    const stats = document.getElementById('chest-stats');

    if (!program) {
        body.innerHTML = '';
        noMsg.classList.remove('hidden');
        stats.innerHTML = '';
        return;
    }

    // Filter participants for this item
    // Honoring department restrictions if Deputy Secretary
    currentChestRegistrations = allRegistrations.filter(r =>
        !r.isDeleted &&
        r.program === program &&
        (currentUserDept === "Main Admin" || currentUserRole === "Admin" || currentUserRole === "Chest" || (r.department === currentUserDept || getMappedDepartment(r.department) === getMappedDepartment(currentUserDept)))
    );

    noMsg.classList.add('hidden');
    body.innerHTML = '';

    const assignedCount = currentChestRegistrations.filter(r => r.chestNumber || r.chessNumber).length;
    stats.innerHTML = `
                <span>Total: <strong>${currentChestRegistrations.length}</strong></span>
                <span>Assigned: <strong style="color: var(--success)">${assignedCount}</strong></span>
                <span>Remaining: <strong style="color: var(--accent-primary)">${currentChestRegistrations.length - assignedCount}</strong></span>
            `;

    currentChestRegistrations.sort((a, b) => (a.chestNumber || a.chessNumber || 999) - (b.chestNumber || b.chessNumber || 999)).forEach(r => {
        const effectiveChestNum = r.chestNumber || r.chessNumber;
        const tr = document.createElement('tr');
        tr.innerHTML = `
                    <td>
                        <div style="font-weight: 600;">${r.regType === 'Group' ? (r.groupName || r.studentName || '-') : (r.studentName || '-')}</div>
                        <div style="font-size: 0.7rem; color: var(--text-muted);">${r.phone || '-'}</div>
                    </td>
                    <td><span class="badge badge-dept">${(r.department || '-').replace('Dep. of ', '')}</span></td>
                    <td><code>${r.rollNumber || '-'}</code></td>
                    <td>
                        ${effectiveChestNum ? `<span class="chest-badge">${effectiveChestNum}</span>` : '<span style="color: var(--text-muted); font-size: 0.8rem;">Not Drawn</span>'}
                    </td>
                    <td>
                        ${effectiveChestNum ? `<button onclick="revokeChestNumber('${r.id}', '${(r.studentName || 'Participant').replace(/'/g, "\\'")}')" class="btn-tab" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.2); padding: 0.4rem 0.8rem; font-size: 0.75rem;"><i class="fas fa-undo"></i> Revoke</button>` :
                `<button onclick="openChestDrawModal('${r.id}', '${(r.studentName || 'Participant').replace(/'/g, "\\'")}', '${r.program.replace(/'/g, "\\'")}')" class="btn-tab active" style="padding: 0.4rem 0.8rem; font-size: 0.75rem;"><i class="fas fa-hand-pointer"></i> Draw Number</button>`}
                    </td>
                `;
        body.appendChild(tr);
    });
};

let currentDrawContext = null;

window.openChestDrawModal = (regId, name, program) => {
    currentDrawContext = { regId, name, program };
    const modal = document.getElementById('chest-draw-modal');
    const container = document.getElementById('chest-cards-container');
    const result = document.getElementById('draw-result-container');

    document.getElementById('chest-draw-subtitle').textContent = `Drawing for: ${name} (${program})`;
    container.innerHTML = '';
    result.classList.add('hidden');
    container.classList.remove('hidden');

    // Calculate total registrations for this program to determine the pool
    const totalInProgram = allRegistrations.filter(r => !r.isDeleted && r.program === program).length;
    const assignedNumbers = allRegistrations.filter(r => !r.isDeleted && r.program === program && (r.chestNumber || r.chessNumber)).map(r => r.chestNumber || r.chessNumber);

    const seriesBase = chestSeriesConfigs[program] || 0;

    // Generate shuffled cards
    const pool = [];
    for (let i = 1; i <= totalInProgram; i++) {
        const num = seriesBase + i;
        pool.push({
            number: num,
            isTaken: assignedNumbers.includes(num)
        });
    }

    // Fisher-Yates shuffle
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }

    pool.forEach((card, idx) => {
        const cardEl = document.createElement('div');
        cardEl.className = `chest-card ${card.isTaken ? 'locked' : ''}`;
        cardEl.innerHTML = '?';
        if (!card.isTaken) {
            cardEl.onclick = () => drawChestNumber(card.number, cardEl);
        }
        container.appendChild(cardEl);
    });

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
};

window.closeChestDrawModal = () => {
    const modal = document.getElementById('chest-draw-modal');
    modal.classList.add('hidden');
    modal.style.display = 'none';
};

window.drawChestNumber = async (num, el) => {
    if (!currentDrawContext) return;
    const { regId, name, program } = currentDrawContext;

    // Visual feedback
    el.classList.add('revealed');
    el.innerHTML = num;

    // Hide other cards and show result
    [...document.querySelectorAll('.chest-card')].forEach(card => {
        if (card !== el) card.style.opacity = '0.2';
    });

    const resultText = document.getElementById('revealed-number');
    resultText.textContent = num;
    document.getElementById('draw-result-container').classList.remove('hidden');

    try {
        await updateDoc(doc(db, "registrations", regId), {
            chestNumber: num
        });
        log(`Chest number ${num} assigned to ${name} for ${program}`);

        // Update local state
        const reg = allRegistrations.find(r => r.id === regId);
        if (reg) reg.chestNumber = num;

        loadChestParticipants();
    } catch (e) {
        log("Draw Update Error:", e);
        alert("Failed to save draw: " + e.message);
    }
};

window.revokeChestNumber = async (regId, name) => {
    if (!confirm(`Are you sure you want to revoke the chest number for "${name}"? This number will become available for redraw.`)) return;

    try {
        await updateDoc(doc(db, "registrations", regId), {
            chestNumber: deleteField()
        });
        log(`Chest number revoked for ${name}`);

        // Update local state
        const reg = allRegistrations.find(r => r.id === regId);
        if (reg) delete reg.chestNumber;

        loadChestParticipants();
        alert(`Chest number for "${name}" has been revoked.`);
    } catch (e) {
        log("Revoke Error:", e);
        alert("Failed to revoke number: " + e.message);
    }
};

// --- Auth Logic ---


const applyRoleRestrictions = (role) => {
    const sidebarItems = document.querySelectorAll('.nav-item');
    const statsGrid = document.querySelector('.stats-grid');

    if (role === 'Leaderboard') {
        sidebarItems.forEach(item => {
            if (item.dataset.nav !== 'leaderboard') {
                item.style.display = 'none';
            }
        });
        if (statsGrid) statsGrid.style.display = 'none';

        // Hide registration filters if they should be hidden
        const regFilters = document.getElementById('reg-filters');
        if (regFilters) regFilters.style.display = 'none';
    } else if (role === 'Chest') {
        sidebarItems.forEach(item => {
            if (item.dataset.nav !== 'chest') {
                item.style.display = 'none';
            }
        });
        if (statsGrid) statsGrid.style.display = 'none';
        const regFilters = document.getElementById('reg-filters');
        if (regFilters) regFilters.style.display = 'none';
    } else {
        sidebarItems.forEach(item => item.style.display = 'flex');
        if (statsGrid) statsGrid.style.display = 'grid';
        const regFilters = document.getElementById('reg-filters');
        if (regFilters) regFilters.style.display = 'flex';
    }
};

const showDashboard = (user, role) => {
    currentUserRole = role;
    log(`Authorized as ${role}:`, user.email);

    loginView.classList.add('hidden');
    adminDashboard.classList.remove('hidden');
    userEmailSpan.textContent = user.email;

    applyRoleRestrictions(role);

    let initialView = 'registrations';
    if (role === 'Leaderboard') initialView = 'leaderboard';
    if (role === 'Chest') initialView = 'chest';

    switchView(initialView);

    // Ensure year is loaded before refreshing data
    fetchSystemYear().then(() => {
        refreshAll();
    });
};

// Helper to check whitelist status
const checkWhitelistStatus = async (email) => {
    const emailLower = email.toLowerCase();
    try {
        // 1. Try year-scoped ID (new format) - Ensure year is fetched first
        if (!systemYear) await fetchSystemYear();
        const yearScopedId = `${emailLower}_${systemYear}`;
        const yearSnap = await getDoc(doc(db, "whitelisted_emails", yearScopedId));
        if (yearSnap.exists()) {
            return yearSnap.data();
        }

        // 2. Try legacy single document ID
        const docSnap = await getDoc(doc(db, "whitelisted_emails", emailLower));
        if (docSnap.exists()) {
            return docSnap.data();
        }

        // 3. Fallback: query by email field
        const q = query(collection(db, "whitelisted_emails"), where("email", "==", emailLower));
        const querySnapshot = await getDocs(q);
        if (!querySnapshot.empty) {
            return querySnapshot.docs[0].data();
        }
    } catch (error) {
        log("Whitelist check error:", error);
    }
    return null;
};

onAuthStateChanged(auth, async (user) => {
    if (user) {
        log("Auth state changed: Logged in as " + user.email);

        // Presence Tracking
        const userStatusRef = ref(rtdb, 'status/' + user.uid);
        const userHistoryRef = ref(rtdb, 'status_history/' + user.uid);

        const isOfflineForDatabase = {
            state: 'offline',
            last_changed: serverTimestamp(),
            email: user.email,
            displayName: user.displayName,
            role: 'Admin'
        };
        const isOnlineForDatabase = {
            state: 'online',
            last_changed: serverTimestamp(),
            email: user.email,
            displayName: user.displayName,
            role: 'Admin'
        };

        onValue(ref(rtdb, '.info/connected'), (snapshot) => {
            if (snapshot.val() === false) return;

            onDisconnect(userStatusRef).set(isOfflineForDatabase).then(() => {
                // Optional: push history on disconnect (might be best effort)
                /* 
                   Note: 'onDisconnect' operations run on the server when the client disconnects, 
                   so we can't easily 'push' a new ID with it. 
                   However, we can just rely on the 'online' event to log the previous session or start of new.
                   But a better approach for history is to push a 'login' event now.
                */
            });

            set(userStatusRef, isOnlineForDatabase).then(() => {
                // Push a history entry for this login
                push(userHistoryRef, {
                    state: 'online',
                    timestamp: serverTimestamp(),
                    email: user.email
                });
            });
        });




        // Check Hardcoded Super Admins (Fail-Safe)
        const emailLower = user.email.toLowerCase();
        const HARDCODED_ADMINS = ["collageunionprc@gmail.com", "artsfest@prc.ac.in"];
        if (HARDCODED_ADMINS.includes(emailLower)) {
            console.log("Hardcoded Admin Access Granted");
            currentUserDept = "Main Admin";
            currentUserAllowedCourses = [];
            showDashboard(user, 'Admin');
            return;
        }

        // Check Firestore Admin Users (Main Admin Access)
        try {
            // Check by Email (Standard via Core Admin)
            const adminByEmailRef = doc(db, "admin_users", emailLower);
            const adminByEmailSnap = await getDoc(adminByEmailRef);

            // Check by UID (Legacy/Manual Console Entry)
            const adminByUidRef = doc(db, "admin_users", user.uid);
            const adminByUidSnap = await getDoc(adminByUidRef);

            if (adminByEmailSnap.exists() || adminByUidSnap.exists()) {
                currentUserDept = "Main Admin";
                currentUserAllowedCourses = [];
                showDashboard(user, 'Admin');
                return;
            }

            // Check by Querying Email field (handling custom UIDs vs Auth UIDs)
            if (!adminByEmailSnap.exists() && !adminByUidSnap.exists()) {
                const adminQuery = query(collection(db, "admin_users"), where("email", "==", emailLower));
                const querySnap = await getDocs(adminQuery);
                if (!querySnap.empty) {
                    currentUserDept = "Main Admin";
                    currentUserAllowedCourses = [];
                    showDashboard(user, 'Admin');
                    return;
                }
            }
        } catch (error) {
            log("Admin check error (non-fatal):", error);
        }


        // Check Firestore Whitelist
        try {
            const whitelistData = await checkWhitelistStatus(user.email);

            if (whitelistData) {
                currentUserDept = whitelistData.department;
                currentUserAllowedCourses = whitelistData.allowedCourses || [];
                showDashboard(user, whitelistData.role || 'Main');
            } else {
                log("Unauthorized access attempt:", user.email);
                statusMsg.innerHTML = `<span class="error">Access Denied. ${user.email} is not authorized.</span>`;
                push(ref(rtdb, 'status_history/' + user.uid), {
                    state: 'offline',
                    timestamp: serverTimestamp(),
                    email: user.email,
                    note: 'Unauthorized access'
                });
                signOut(auth);
            }
        } catch (error) {
            log("Auth check error:", error);
            statusMsg.innerHTML = `<span class="error">Verification Error: ${error.message}</span>`;
        }
    } else {
        log("No user logged in.");
        loginView.classList.remove('hidden');
        adminDashboard.classList.add('hidden');
        userEmailSpan.textContent = "";
    }
});

googleLoginBtn.onclick = async () => {
    statusMsg.innerHTML = '<span style="color: var(--text-secondary)">Signing in...</span>';
    try {
        await signInWithPopup(auth, provider);
    } catch (error) {
        log("Login Error:", error);
        statusMsg.innerHTML = `<span class="error">Login failed: ${error.message}</span>`;
    }
};

logoutBtn.onclick = () => {
    if (confirm("Are you sure you want to logout?")) {
        const user = auth.currentUser;
        if (user) {
            push(ref(rtdb, 'status_history/' + user.uid), {
                state: 'offline',
                timestamp: serverTimestamp(),
                email: user.email
            });
        }
        signOut(auth);
    }
};

window.openPDFPreview = () => {
    currentPDFFilename = ""; // Reset filename for standard reports
    const btn = document.querySelector('button[title="Download as PDF"]');
    const originalContent = '<i class="fas fa-file-pdf"></i> Download';

    if (btn) {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparing...';
        btn.disabled = true;
    }

    const filteredData = allRegistrations.filter(student =>
        matchesRegistration(student,
            currentFilters.dept,
            currentRegTab,
            '',
            currentFilters.search,
            currentFilters.year,
            currentFilters.item
        )
    );

    // Sort by Time (AM to PM)
    filteredData.sort((a, b) => {
        const dateTimeA = programDates[a.program]?.date || '';
        const dateTimeB = programDates[b.program]?.date || '';

        if (!dateTimeA && !dateTimeB) return 0;
        if (!dateTimeA) return 1;
        if (!dateTimeB) return -1;

        try {
            // Format usually "Jan 17, 10:00 AM"
            const dateA = new Date(dateTimeA.replace(',', ', 2026'));
            const dateB = new Date(dateTimeB.replace(',', ', 2026'));
            return dateA - dateB;
        } catch (e) {
            return 0;
        }
    });

    // 2. Build PDF Content
    const wrapper = document.createElement('div');
    wrapper.id = 'pdf-content-wrapper';
    wrapper.style.width = '1000px';
    wrapper.style.minHeight = '1414px'; // ~A4 height at this width
    wrapper.style.padding = '40px';
    wrapper.style.fontFamily = "'Inter', sans-serif";
    wrapper.style.color = '#1e293b';
    wrapper.style.background = '#ffffff';
    wrapper.style.boxSizing = 'border-box';

    // 3. Header Construction
    const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const logoSrc = "../assets/Pazhassiraja_College_Pulpally_Logo.png";

    let filterSummary = [];
    if (currentFilters.dept) filterSummary.push(`<span style="background:#e2e8f0; padding:4px 8px; border-radius:4px; font-size:0.8rem;">${currentFilters.dept}</span>`);
    if (currentFilters.year) filterSummary.push(`<span style="background:#e2e8f0; padding:4px 8px; border-radius:4px; font-size:0.8rem;">${currentFilters.year}</span>`);
    if (currentFilters.item) filterSummary.push(`<span style="background:#e2e8f0; padding:4px 8px; border-radius:4px; font-size:0.8rem;">Item: ${currentFilters.item}</span>`);
    if (!filterSummary.length) filterSummary.push(`<span style="background:#e2e8f0; padding:4px 8px; border-radius:4px; font-size:0.8rem;">All Records</span>`);

    wrapper.innerHTML = `
                <style>
                    #pdf-content-wrapper tr { page-break-inside: avoid; break-inside: avoid; }
                    #pdf-content-wrapper td, #pdf-content-wrapper th { page-break-inside: avoid; break-inside: avoid; border: 1px solid #cbd5e1; white-space: normal; color: #1e293b; }
                    #pdf-content-wrapper thead { display: table-header-group; }
                    #pdf-content-wrapper tfoot { display: table-footer-group; }
                </style>
                <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 2rem; border-bottom: 2px solid #6366f1; padding-bottom: 1.5rem;">
                    <img src="${logoSrc}" style="height: 80px; margin-right: 20px;" alt="Logo">
                    <div style="text-align: left;">
                        <h1 style="margin: 0; color: #1e293b; font-size: 2rem; font-weight: 800; text-transform: uppercase; letter-spacing: -0.02em;">College Union PRC</h1>
                        <h2 style="margin: 5px 0 0 0; color: #64748b; font-size: 1rem; font-weight: 500;">Arts Festival ${systemYear} - Registration Report</h2>
                    </div>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 1.5rem;">
                    <div>
                        <div style="font-size: 0.85rem; color: #64748b; margin-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Active Filters</div>
                        <div style="display: flex; gap: 0.5rem;">${filterSummary.join('')}</div>
                    </div>
                    <div style="text-align: right;">
                         <div style="font-size: 0.85rem; color: #64748b; margin-bottom: 0px;">Category</div>
                         <div style="font-size: 1.2rem; font-weight: 700; color: #6366f1;">${currentRegTab}</div>
                         <div style="font-size: 0.75rem; color: #94a3b8; margin-top: 4px;">Generated on ${dateStr}</div>
                    </div>
                </div>

                <table style="width: 100%; border-collapse: collapse; font-size: 0.9rem;">
                    <thead>
                        <tr style="background: #f1f5f9; color: #475569;">
                            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #cbd5e1; font-weight: 600; background: #f1f5f9; color: #475569;">#</th>
                            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #cbd5e1; font-weight: 600; background: #f1f5f9; color: #475569;">Student / Group</th>
                            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #cbd5e1; font-weight: 600; background: #f1f5f9; color: #475569;">Department</th>
                            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #cbd5e1; font-weight: 600; background: #f1f5f9; color: #475569;">Roll No</th>
                            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #cbd5e1; font-weight: 600; background: #f1f5f9; color: #475569;">Year</th>
                            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #cbd5e1; font-weight: 600; background: #f1f5f9; color: #475569;">Type</th>
                            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #cbd5e1; font-weight: 600; background: #f1f5f9; color: #475569;">Item / Program</th>
                            <th style="padding: 12px; text-align: left; border-bottom: 2px solid #cbd5e1; font-weight: 600; background: #f1f5f9; color: #475569;">Schedule</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filteredData.map((d, index) => {
        const pData = programDates[d.program];
        const scheduleStr = pData ?
            `<div style="font-weight:600; color:#4f46e5;">${pData.date || 'TBD'}</div><div style="font-size:0.8rem; color:#64748b;">${pData.stage || '-'}</div>`
            : '<span style="color:#94a3b8;">TBD</span>';

        return `
                        <tr style="border-bottom: 1px solid #e2e8f0;">
                            <td style="padding: 10px 12px; color: #64748b; background: #fff;">${index + 1}</td>
                            <td style="padding: 10px 12px; color: #0f172a; background: #fff;">
                                <div style="font-weight: 600;">${d.regType === 'Group' ? (d.groupName || d.studentName || '-') : (d.studentName || '-')}</div>
                                ${d.regType === 'Group' && d.studentName && d.groupName ? `<div style="font-size: 0.75rem; color: #6366f1; font-weight: 700;">Leader: ${d.studentName}</div>` : ''}
                                ${d.groupMembers && d.groupMembers.length ? `<div style="font-size: 0.65rem; color: #64748b; margin-top: 2px;">Members: ${d.groupMembers.map(m => m.name).join(', ')}</div>` : ''}
                            </td>
                            <td style="padding: 10px 12px; color: #1e293b; background: #fff;">${(d.department || '-').replace('Dep. of ', '')}</td>
                            <td style="padding: 10px 12px; font-family: monospace; color: #0f172a; background: #fff;">${d.rollNumber || '-'}</td>
                            <td style="padding: 10px 12px; color: #1e293b; background: #fff;">${d.year || '-'}</td>
                            <td style="padding: 10px 12px; color: #1e293b; background: #fff;">${d.regType || 'Individual'}</td>
                            <td style="padding: 10px 12px; color: #1e293b; background: #fff;">${d.program || '-'}</td>
                            <td style="padding: 10px 12px; background: #fff;">${scheduleStr}</td>
                        </tr>
                        `;
    }).join('')}
                    </tbody>
                </table>
                
                <div style="margin-top: 2rem; border-top: 1px solid #e2e8f0; padding-top: 1rem; display: flex; justify-content: space-between; font-size: 0.75rem; color: #94a3b8;">
                    <span>Pazhassiraja College Pulpally</span>
                    <span>Page 1 of 1</span>
                </div>
            `;

    // Inject into Preview
    const container = document.getElementById('pdf-preview-container');
    container.innerHTML = '';
    container.appendChild(wrapper);

    // Show Modal
    const modal = document.getElementById('pdf-preview-modal');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    if (btn) {
        btn.innerHTML = originalContent;
        btn.disabled = false;
    }
};

window.closePDFPreview = () => {
    const modal = document.getElementById('pdf-preview-modal');
    modal.classList.add('hidden');
    modal.style.display = 'none';
    document.getElementById('pdf-preview-container').innerHTML = '';
};

let currentPDFFilename = "";

window.openJudgeSheetPreview = () => {
    const btn = document.querySelector('button[title="Print Judge Sheets"]');
    const originalContent = '<i class="fas fa-gavel"></i> Judge Sheets';

    if (btn) {
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Preparing...';
        btn.disabled = true;
    }

    // 1. Prepare Data
    let filteredData = [];
    let localCategory = currentRegTab;

    if (currentView === 'chest') {
        const selectedProg = document.getElementById('chest-item-select').value;
        if (!selectedProg) {
            alert("Please select a program first to generate judge sheets.");
            if (btn) {
                btn.innerHTML = originalContent;
                btn.disabled = false;
            }
            return;
        }
        filteredData = allRegistrations.filter(r => !r.isDeleted && r.program === selectedProg);
        // Determine category for header
        if (ON_STAGE_EVENTS.includes(selectedProg)) localCategory = "On Stage";
        else if (OFF_STAGE_EVENTS.includes(selectedProg)) localCategory = "Off Stage";
    } else {
        filteredData = allRegistrations.filter(student =>
            matchesRegistration(student,
                currentFilters.dept,
                currentRegTab,
                '',
                currentFilters.search,
                currentFilters.year,
                currentFilters.item
            )
        );
    }

    // Group by Item/Program
    const grouped = {};
    filteredData.forEach(d => {
        const item = d.program || "Unknown Item";
        if (!grouped[item]) grouped[item] = [];
        grouped[item].push(d);
    });

    // Sort Items Alphabetically
    const sortedItems = Object.keys(grouped).sort();

    if (sortedItems.length === 0) {
        alert("No registrations found for the current selection.");
        if (btn) {
            btn.innerHTML = originalContent;
            btn.disabled = false;
        }
        return;
    }

    // 2. Build PDF Content
    const wrapper = document.createElement('div');
    wrapper.id = 'pdf-content-wrapper';
    wrapper.style.width = '1000px';
    wrapper.style.minHeight = '1414px';
    wrapper.style.padding = '40px';
    wrapper.style.fontFamily = "'Inter', sans-serif";
    wrapper.style.color = '#1e293b';
    wrapper.style.background = '#ffffff';
    wrapper.style.boxSizing = 'border-box';

    const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    const logoSrc = "../assets/Pazhassiraja_College_Pulpally_Logo.png";

    // Helper function to shorten department names for printing
    const shortenDept = (dept) => {
        if (!dept) return '-';
        return dept
            .replace('Dep. of ', '')
            .replace('B.A English Language and Literature', 'BA English')
            .replace('B.A Economics', 'BA Economics')
            .replace('B.A History', 'BA History')
            .replace('B.A Malayalam', 'BA Malayalam')
            .replace('Bachelor of Travel and Tourism Management (BTTM)', 'BTTM')
            .replace('Master of Travel and Tourism Management (MTTM)', 'MTTM')
            .replace('M.COM', 'M.COM')
            .replace('Commerce', 'Commerce')
            .replace('Business Administration', 'BBA');
    };

    let contentHtml = `
                 <style>
                     .judge-sheet-page { page-break-after: always; display: flex; flex-direction: column; background: white; padding: 40px; margin-bottom: 20px; }
                     .judge-sheet-page:last-child { page-break-after: avoid; }
                     table { border-collapse: collapse; width: 100%; }
                     th, td { border: 1px solid #000; padding: 8px; text-align: left; color: #000; }
                     th { background: #f1f5f9; font-weight: 600; text-transform: uppercase; font-size: 0.8rem; color: #000; }
                 </style>
             `;

    sortedItems.forEach(item => {
        const participants = grouped[item].sort((a, b) => (a.chestNumber || a.chessNumber || 999) - (b.chestNumber || b.chessNumber || 999));

        contentHtml += `
                 <div class="judge-sheet-page">
                     <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 1.5rem; border-bottom: 2px solid #000; padding-bottom: 1rem;">
                        <img src="${logoSrc}" style="height: 60px; margin-right: 15px;" alt="Logo">
                        <div style="text-align: center;">
                            <h1 style="margin: 0; font-size: 1.5rem; text-transform: uppercase;">College Union PRC</h1>
                            <h2 style="margin: 5px 0 0 0; font-size: 0.9rem; font-weight: 500;">Arts Festival ${systemYear} - Judge Scoring Sheet</h2>
                        </div>
                    </div>

                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1.5rem; font-size: 0.9rem; border: 1px solid #000; padding: 1rem;">
                        <div><strong>Item / Program:</strong> <span style="font-size: 1.1rem; font-weight: 700;">${item}</span></div>
                        <div><strong>Category:</strong> ${localCategory}</div>
                        <div><strong>Date:</strong> ${dateStr}</div>
                        <div><strong>Judge Name:</strong> ____________________________</div>
                    </div>

                    <table style="font-size: 0.85rem;">
                        <thead>
                            <tr>
                                <th style="width: 50px;">#</th>
                                <th style="width: 150px; text-align: center;">Chest Number</th>
                                <th style="width: 80px; text-align: center;">Criteria 1<br>(10)</th>
                                <th style="width: 80px; text-align: center;">Criteria 2<br>(10)</th>
                                <th style="width: 80px; text-align: center;">Criteria 3<br>(10)</th>
                                <th style="width: 80px; text-align: center;">Total<br>(30)</th>
                                <th style="width: 150px; text-align: center;">Remarks</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${participants.map((p, idx) => `
                            <tr>
                                <td style="text-align: center;">${idx + 1}</td>
                                <td style="text-align: center; font-size: 1.2rem; font-weight: 700;">
                                    ${p.chestNumber || p.chessNumber || '-'}
                                </td>
                                <td></td>
                                <td></td>
                                <td></td>
                                <td></td>
                                <td></td>
                            </tr>
                            `).join('')}
                        </tbody>
                    </table>

                     <div style="padding-top: 2rem; display: flex; justify-content: space-between; font-size: 0.8rem;">
                        <div>Signature of Judge: _______________________</div>
                        <div>Total Participants: ${participants.length}</div>
                    </div>
                 </div>
                 `;
    });

    wrapper.innerHTML = contentHtml;

    // Inject into Preview
    const container = document.getElementById('pdf-preview-container');
    container.innerHTML = '';
    container.appendChild(wrapper);

    // Set Filename
    currentPDFFilename = `Judge_Sheet_${localCategory.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`;

    // Show Modal
    const modal = document.getElementById('pdf-preview-modal');
    modal.classList.remove('hidden');
    modal.style.display = 'flex';

    if (btn) {
        btn.innerHTML = originalContent;
        btn.disabled = false;
    }
};

window.processPDFDownload = () => {
    const wrapper = document.getElementById('pdf-content-wrapper');
    const btn = document.querySelector('#pdf-preview-modal .btn-tab:last-child'); // The download button
    const originalText = btn.innerHTML;

    if (!wrapper) return;

    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
    btn.disabled = true;

    const filename = currentPDFFilename || `PRC_${currentRegTab.replace(/\s+/g, '_')}_Report_${new Date().toISOString().split('T')[0]}.pdf`;

    const opt = {
        margin: 10,
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
        pagebreak: { mode: ['css', 'legacy'] }
    };

    html2pdf().from(wrapper).set(opt).save().then(() => {
        btn.innerHTML = '<i class="fas fa-check"></i> Done';
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.disabled = false;
        }, 2000);
    }).catch(err => {
        console.error("PDF Export Error:", err);
        alert("Error generating PDF.");
        btn.innerHTML = originalText;
        btn.disabled = false;
    });
};

window.renderReview = () => {
    const reviewBody = document.getElementById('review-body');
    const noReviewMsg = document.getElementById('no-review-msg');
    if (!reviewBody) return;
    reviewBody.innerHTML = '';

    // Grouping logic
    const studentGroups = {};
    const deptItemCounts = {};
    const itemStats = {}; // Track participants and departments per item

    allRegistrations.forEach(r => {
        if (r.isCanceled || r.isDeleted) return; // Skip canceled/deleted registrations for audit flags
        // 1. Student-specific tracking
        const key = `${r.department}_${r.rollNumber}_${r.year}`;
        if (!studentGroups[key]) {
            studentGroups[key] = {
                studentName: r.studentName,
                department: r.department,
                rollNumber: r.rollNumber,
                year: r.year,
                offStageCount: 0,
                onStageIndCount: 0,
                hasCanceled: false
            };
        }

        if (r.isCanceled) studentGroups[key].hasCanceled = true;

        const cat = (r.category || "").trim().toLowerCase();
        const type = (r.regType || "Individual").trim().toLowerCase();

        if (cat === "off stage") {
            studentGroups[key].offStageCount++;
            // Track Dept + Item count for Off Stage
            if (r.program && r.department) {
                const deptItemKey = `${r.department}|${r.program}`;
                deptItemCounts[deptItemKey] = (deptItemCounts[deptItemKey] || 0) + 1;
            }
        } else if (cat === "on stage" && type === "individual") {
            studentGroups[key].onStageIndCount++;
        }

        // 2. Item-wide tracking (for all categories)
        if (r.program) {
            if (!itemStats[r.program]) {
                itemStats[r.program] = {
                    count: 0,
                    departments: new Set(),
                    category: r.category || "On Stage"
                };
            }
            itemStats[r.program].count++;
            if (r.department) itemStats[r.program].departments.add(r.department);
        }
    });

    // Filtering logic
    const flaggedStudents = Object.values(studentGroups).filter(g => g.offStageCount > 3 || g.onStageIndCount > 3);

    const flaggedDeptItems = [];
    for (const [key, count] of Object.entries(deptItemCounts)) {
        if (count > 3) {
            const [dept, item] = key.split('|');
            flaggedDeptItems.push({ department: dept, item: item, count: count });
        }
    }

    const flaggedItemParticipation = [];
    for (const [item, stats] of Object.entries(itemStats)) {
        // Rule 1: < 3 participants
        if (stats.count < 3) {
            flaggedItemParticipation.push({
                item: item,
                count: stats.count,
                reason: "Low Participation",
                category: stats.category,
                severity: "warning"
            });
        }
        // Rule 2: 3 participants from same department
        else if (stats.count === 3 && stats.departments.size === 1) {
            flaggedItemParticipation.push({
                item: item,
                count: stats.count,
                reason: "Single Dept (3 Participants)",
                category: stats.category,
                severity: "error",
                department: Array.from(stats.departments)[0]
            });
        }
    }

    if (flaggedStudents.length === 0 && flaggedDeptItems.length === 0 && flaggedItemParticipation.length === 0) {
        noReviewMsg.classList.remove('hidden');
    } else {
        noReviewMsg.classList.add('hidden');
    }

    // Rendering
    flaggedStudents.forEach(student => {
        const tr = document.createElement('tr');
        const OSFlag = student.offStageCount > 3;
        const OIFlag = student.onStageIndCount > 3;

        tr.innerHTML = `
                    <td>
                        <div style="font-weight: 600;">
                            ${student.studentName || '-'}
                            ${student.hasCanceled ? '<span class="badge" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; margin-left: 8px; font-size: 0.6rem; border: 1px solid rgba(239, 68, 68, 0.2);">CANCELED</span>' : ''}
                        </div>
                    </td>
                    <td><span class="badge badge-dept">${(student.department || '-').replace('Dep. of ', '')}</span></td>
                    <td><code>${student.rollNumber || '-'}</code></td>
                    <td>${student.year || '-'}</td>
                    <td>
                        <div style="display: flex; flex-direction: column; gap: 4px;">
                            ${OSFlag ? `<span class="badge" style="background: rgba(239, 68, 68, 0.1); color: var(--error); font-weight: 800; cursor: pointer;" onclick="viewStudentIssues('${student.department.replace(/'/g, "\\'")}', '${student.rollNumber}', 'Off Stage')">Off-Stage: ${student.offStageCount}</span>` : ''}
                            ${OIFlag ? `<span class="badge" style="background: rgba(239, 68, 68, 0.1); color: var(--error); font-weight: 800; cursor: pointer;" onclick="viewStudentIssues('${student.department.replace(/'/g, "\\'")}', '${student.rollNumber}', 'On Stage')">On-Stage Ind: ${student.onStageIndCount}</span>` : ''}
                        </div>
                    </td>
                    <td>
                        <button onclick="viewStudentIssues('${student.department.replace(/'/g, "\\'")}', '${student.rollNumber}', '${OSFlag ? 'Off Stage' : 'On Stage'}')" class="btn-tab active" style="padding: 0.4rem 0.75rem; font-size: 0.75rem;">Inspect</button>
                    </td>
                `;
        reviewBody.appendChild(tr);
    });

    flaggedDeptItems.forEach(violation => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
                    <td>
                        <div style="font-weight: 600; color: var(--warning);">${violation.item}</div>
                        <div style="font-size: 0.7rem; color: var(--text-muted);">Department Limit Exceeded</div>
                    </td>
                    <td><span class="badge badge-dept">${(violation.department || '-').replace('Dep. of ', '')}</span></td>
                    <td>-</td>
                    <td>-</td>
                    <td style="vertical-align: middle;">
                        <span class="badge" style="background: rgba(239, 68, 68, 0.1); color: var(--error); font-weight: 800;">
                            Registrations: ${violation.count} (Max 3)
                        </span>
                    </td>
                    <td style="vertical-align: middle;">
                        <button onclick="viewDepartmentItemIssues('${violation.department.replace(/'/g, "\\'")}', '${violation.item.replace(/'/g, "\\'")}')" class="btn-tab active" style="padding: 0.4rem 0.75rem; font-size: 0.75rem;">Inspect</button>
                    </td>
                `;
        reviewBody.appendChild(tr);
    });

    flaggedItemParticipation.forEach(p => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
                    <td>
                        <div style="font-weight: 600; color: ${p.severity === 'error' ? 'var(--error)' : 'var(--warning)'}">${p.item}</div>
                        <div style="font-size: 0.7rem; color: var(--text-muted);">${p.reason}</div>
                    </td>
                    <td>${p.department ? `<span class="badge badge-dept">${p.department.replace('Dep. of ', '')}</span>` : '-'}</td>
                    <td>-</td>
                    <td>-</td>
                    <td style="vertical-align: middle;">
                        <span class="badge" style="background: rgba(${p.severity === 'error' ? '239, 68, 68' : '245, 158, 11'}, 0.1); color: ${p.severity === 'error' ? 'var(--error)' : 'var(--warning)'}; font-weight: 800;">
                            Participants: ${p.count}
                        </span>
                    </td>
                    <td style="vertical-align: middle;">
                        <button onclick="viewItemIssues('${p.item.replace(/'/g, "\\'")}', '${p.category}')" class="btn-tab active" style="padding: 0.4rem 0.75rem; font-size: 0.75rem;">Inspect</button>
                    </td>
                `;
        reviewBody.appendChild(tr);
    });

    // Update Badge Count
    const totalIssues = flaggedStudents.length + flaggedDeptItems.length + flaggedItemParticipation.length;
    const badge = document.getElementById('review-count-badge');
    if (badge) {
        badge.textContent = totalIssues;
        if (totalIssues > 0) badge.classList.remove('hidden');
        else badge.classList.add('hidden');
    }
};

const updateReviewCount = () => {
    const studentGroups = {};
    const deptItemCounts = {};
    const itemStats = {};

    allRegistrations.forEach(r => {
        if (r.isCanceled || r.isDeleted) return; // Skip canceled/deleted
        const key = `${r.department}_${r.rollNumber}_${r.year}`;
        if (!studentGroups[key]) {
            studentGroups[key] = { offStageCount: 0, onStageIndCount: 0 };
        }
        const cat = (r.category || "").trim().toLowerCase();
        const type = (r.regType || "Individual").trim().toLowerCase();
        if (cat === "off stage") {
            studentGroups[key].offStageCount++;
            if (r.program && r.department) {
                const deptItemKey = `${r.department}|${r.program}`;
                deptItemCounts[deptItemKey] = (deptItemCounts[deptItemKey] || 0) + 1;
            }
        } else if (cat === "on stage" && type === "individual") {
            studentGroups[key].onStageIndCount++;
        }

        if (r.program) {
            if (!itemStats[r.program]) {
                itemStats[r.program] = { count: 0, depts: new Set() };
            }
            itemStats[r.program].count++;
            if (r.department) itemStats[r.program].depts.add(r.department);
        }
    });

    const flaggedStudentsCount = Object.values(studentGroups).filter(g => g.offStageCount > 3 || g.onStageIndCount > 3).length;
    let flaggedDeptItemsCount = 0;
    for (const count of Object.values(deptItemCounts)) {
        if (count > 3) flaggedDeptItemsCount++;
    }

    let flaggedItemParticiCount = 0;
    for (const stats of Object.values(itemStats)) {
        if (stats.count < 3 || (stats.count === 3 && stats.depts.size === 1)) {
            flaggedItemParticiCount++;
        }
    }

    const totalIssues = flaggedStudentsCount + flaggedDeptItemsCount + flaggedItemParticiCount;
    const badge = document.getElementById('review-count-badge');
    if (badge) {
        badge.textContent = totalIssues;
        if (totalIssues > 0) badge.classList.remove('hidden');
        else badge.classList.add('hidden');
    }
};

const getMappedDepartment = (deptName) => {
    if (!deptName) return "";
    if (DEPARTMENTS.includes(deptName)) return deptName;
    for (const [mainDept, courses] of Object.entries(DEPT_COURSES)) {
        if (courses.includes(deptName)) return mainDept;
    }
    const lower = deptName.toLowerCase().trim();
    const matchedKey = DEPARTMENTS.find(d => d.toLowerCase() === lower);
    if (matchedKey) return matchedKey;
    for (const [mainDept, courses] of Object.entries(DEPT_COURSES)) {
        if (courses.some(c => c.toLowerCase().trim() === lower)) return mainDept;
    }
    return deptName;
};

window.openInspectModal = (title, registrations, context) => {
    const modal = document.getElementById('inspect-modal');
    const body = document.getElementById('inspect-modal-body');
    const titleElem = document.getElementById('inspect-modal-title');
    const bulkBtn = document.getElementById('inspect-bulk-btn');
    if (!modal || !body) return;

    window.currentInspectContext = context;
    window.currentInspectRegs = registrations; // Track for bulk action
    titleElem.textContent = title;
    body.innerHTML = '';

    const anyActive = registrations.some(r => !r.isCanceled);
    if (bulkBtn) {
        if (registrations.length > 0) {
            bulkBtn.style.display = 'block';
            bulkBtn.textContent = anyActive ? "Cancel All" : "Restore All";
            bulkBtn.style.background = anyActive ? "var(--error)" : "var(--success)";
        } else {
            bulkBtn.style.display = 'none';
        }
    }

    if (registrations.length === 0) {
        body.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 2rem; color: var(--text-muted);">No matching registrations found</td></tr>';
    } else {
        registrations.forEach(r => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                        <td>
                            <div style="font-weight: 600;">${r.regType === 'Group' ? (r.groupName || r.studentName || '-') : (r.studentName || '-')}</div>
                            <div style="font-size: 0.7rem; color: var(--text-muted);">${r.phone || '-'}</div>
                        </td>
                        <td>
                            <div style="font-size: 0.8rem;"><code>${r.rollNumber || '-'}</code></div>
                            <div style="font-size: 0.7rem; color: var(--text-muted);">${(r.department || '-').replace('Dep. of ', '')}</div>
                        </td>
                        <td style="font-size: 0.85rem;">${r.program || '-'}</td>
                        <td>
                            ${r.isCanceled ? '<span class="badge" style="background: rgba(239, 68, 68, 0.1); color: #ef4444; font-size: 0.65rem;">CANCELED</span>' : '<span class="badge" style="background: rgba(34, 197, 94, 0.1); color: #22c55e; font-size: 0.65rem;">ACTIVE</span>'}
                        </td>
                    `;
            body.appendChild(tr);
        });
    }

    modal.classList.remove('hidden');
    modal.style.display = 'flex';
};

window.bulkToggleCancel = async () => {
    const regs = window.currentInspectRegs;
    if (!regs || regs.length === 0) return;

    const anyActive = regs.some(r => !r.isCanceled);
    const newStatus = anyActive; // If any is active, we cancel all. If all are canceled, we restore all.
    const actionText = newStatus ? "cancel" : "restore";
    const targetName = document.getElementById('inspect-modal-title').textContent.replace('Issues: ', '').replace('Registrations for ', '');

    if (!confirm(`Are you sure you want to ${actionText} all ${regs.length} registrations for ${targetName}?`)) return;

    const bulkBtn = document.getElementById('inspect-bulk-btn');
    const originalText = bulkBtn.textContent;
    bulkBtn.textContent = "Processing...";
    bulkBtn.disabled = true;

    try {
        // Batch update in Firestore
        const promises = regs.filter(r => r.isCanceled !== newStatus).map(r =>
            updateDoc(doc(db, "registrations", r.id), { isCanceled: newStatus })
        );

        if (promises.length > 0) {
            await Promise.all(promises);
        }

        log(`Bulk ${actionText} successful for ${promises.length} registrations.`);

        // Update local state
        regs.forEach(r => r.isCanceled = newStatus);

        // Refresh UI
        renderTable();
        updateReviewCount();
        renderReview();

        // Refresh Modal
        if (window.currentInspectContext) {
            const { type, params } = window.currentInspectContext;
            if (type === 'student') window.viewStudentIssues(...params);
            else if (type === 'item') window.viewItemIssues(...params);
            else if (type === 'deptItem') window.viewDepartmentItemIssues(...params);
        }
    } catch (e) {
        log("Bulk Toggle Error:", e);
        alert("Failed to update: " + e.message);
    } finally {
        bulkBtn.textContent = originalText;
        bulkBtn.disabled = false;
    }
};

window.closeInspectModal = () => {
    const modal = document.getElementById('inspect-modal');
    if (modal) {
        modal.classList.add('hidden');
        modal.style.display = 'none';
    }
    window.currentInspectContext = null;
};

window.viewDepartmentItemIssues = (dept, item) => {
    const targetDept = getMappedDepartment(dept);
    const regs = allRegistrations.filter(r =>
        (r.department === dept || getMappedDepartment(r.department) === targetDept) &&
        r.program === item
    );
    window.openInspectModal(`Issues: ${item} (Dept: ${targetDept})`, regs, { type: 'deptItem', params: [dept, item] });
};

window.viewItemIssues = (item, category) => {
    const regs = allRegistrations.filter(r => r.program === item);
    window.openInspectModal(`Issues: ${item}`, regs, { type: 'item', params: [item, category] });
};

window.viewStudentIssues = (dept, roll, year) => {
    const targetDept = getMappedDepartment(dept);
    const regs = allRegistrations.filter(r =>
        (r.department === dept || getMappedDepartment(r.department) === targetDept) &&
        r.rollNumber === roll
    );
    const studentName = regs.length > 0 ? regs[0].studentName : "Student";
    window.openInspectModal(`Registrations for ${studentName} (${roll})`, regs, { type: 'student', params: [dept, roll, year] });
};

// Initial Fetch call synchronously removed, handled by auth change
// refreshAll();

window.toggleSidebar = () => {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.querySelector('.sidebar-overlay');
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
};

// Close sidebar when clicking a nav item on mobile
document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
        if (window.innerWidth <= 1024) {
            const sidebar = document.querySelector('.sidebar');
            const overlay = document.querySelector('.sidebar-overlay');
            if (sidebar.classList.contains('open')) {
                sidebar.classList.remove('open');
                overlay.classList.remove('active');
            }
        }
    });
});

// Setup Whitelist Role Change Listener
const roleSelect = document.getElementById('new-whitelist-role');
if (roleSelect) {
    roleSelect.addEventListener('change', (e) => {
        const isStageManager = e.target.value === 'Stage Manager';
        const stageContainer = document.getElementById('new-whitelist-stage-container');
        const deptContainer = document.getElementById('new-whitelist-dept').closest('.filter-group');

        if (isStageManager) {
            populateStageOptions(); // Populate when showing
            stageContainer.style.display = 'flex';
            deptContainer.style.display = 'none';
        } else {
            stageContainer.style.display = 'none';
            deptContainer.style.display = 'flex';
        }
    });
}

// Helper to populate stage options from programDates
window.populateStageOptions = () => {
    const select = document.getElementById('new-whitelist-stage');
    if (!select) return;

    const currentVal = select.value;
    const stages = new Set();

    // Extract unique stages
    Object.values(programDates).forEach(p => {
        if (p.stage && p.stage.trim()) {
            stages.add(p.stage.trim());
        }
    });

    // Rebuild options
    select.innerHTML = '<option value="">Select Stage</option>';

    if (stages.size === 0) {
        const opt = document.createElement('option');
        opt.disabled = true;
        opt.textContent = "No stages found in schedule";
        select.appendChild(opt);
        return;
    }

    Array.from(stages).sort().forEach(stage => {
        const opt = document.createElement('option');
        opt.value = stage;
        opt.textContent = stage;
        select.appendChild(opt);
    });

    // Restore selection if valid
    if (stages.has(currentVal)) {
        select.value = currentVal;
    }
};

// Also update stages when dates are fetched
const originalFetchProgramDates = window.fetchProgramDates;
window.fetchProgramDates = async () => {
    await originalFetchProgramDates();
    populateStageOptions();
};


// --- Appeals Logic ---
let allAppeals = [];
let currentAppealFilters = {
    status: '',
    search: '',
    department: '',
    priority: ''
};

window.fetchAppeals = async () => {
    log("Fetching appeals...");
    try {
        const q = query(
            collection(db, "appeals"),
            where("academicYear", "==", systemYear)
        );
        const querySnapshot = await getDocs(q);
        allAppeals = [];
        querySnapshot.forEach((doc) => {
            allAppeals.push({ id: doc.id, ...doc.data() });
        });

        // Sort by submission time
        allAppeals.sort((a, b) => {
            const timeA = a.submittedAt?.toMillis() || 0;
            const timeB = b.submittedAt?.toMillis() || 0;
            return timeB - timeA;
        });

        const pendingCount = allAppeals.filter(a => a.status === 'pending').length;
        const badge = document.getElementById('appeals-count-badge');
        if (badge) {
            badge.textContent = pendingCount;
            badge.classList.toggle('hidden', pendingCount === 0);
        }

        if (currentView === 'appeals') renderAppeals();
        log(`Appeals fetched: ${allAppeals.length} total, ${pendingCount} pending.`);
    } catch (error) {
        log("Error fetching appeals:", error);
    }
};

const renderAppeals = () => {
    const tbody = document.getElementById('appeals-body');
    const noDataMsg = document.getElementById('no-appeals-msg');
    if (!tbody) return;

    tbody.innerHTML = '';

    // Apply filters
    let filtered = allAppeals.filter(appeal => {
        if (currentAppealFilters.status && appeal.status !== currentAppealFilters.status) return false;
        if (currentAppealFilters.department && !appeal.department.includes(currentAppealFilters.department)) return false;
        if (currentAppealFilters.priority && appeal.priority !== currentAppealFilters.priority) return false;
        if (currentAppealFilters.search) {
            const search = currentAppealFilters.search.toLowerCase();
            const matches =
                (appeal.studentName || '').toLowerCase().includes(search) ||
                (appeal.chestNumber || '').toLowerCase().includes(search) ||
                (appeal.programName || '').toLowerCase().includes(search) ||
                (appeal.submittedBy || '').toLowerCase().includes(search);
            if (!matches) return false;
        }
        return true;
    });

    if (filtered.length === 0) {
        noDataMsg?.classList.remove('hidden');
        return;
    }
    noDataMsg?.classList.add('hidden');

    filtered.forEach(appeal => {
        const dateStr = appeal.submittedAt?.toMillis() ? new Date(appeal.submittedAt.toMillis()).toLocaleString() : 'Recently';
        const priority = appeal.priority || 'medium';
        const priorityIcon = priority === 'high' ? '🔴' : priority === 'low' ? '🟢' : '🟡';
        const statusColor = getStatusColor(appeal.status);

        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.onclick = (e) => {
            if (e.target.closest('select') || e.target.closest('button')) return;
            viewAppealDetails(appeal);
        };

        tr.innerHTML = `
            <td>
                <div class="appeal-student-info">
                    <span class="priority-indicator" title="Priority: ${priority}">${priorityIcon}</span>
                    <div class="details">
                        <div style="font-weight: 700; font-size: 0.95rem;">${appeal.studentName}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">
                            <span class="badge" style="background: rgba(99, 102, 241, 0.1); color: var(--accent-primary); border: 1px solid rgba(99, 102, 241, 0.2); padding: 1px 6px; font-size: 0.65rem;">${appeal.chestNumber}</span>
                            <span style="margin: 0 4px;">•</span>
                            ${appeal.department}
                        </div>
                        <div style="font-size: 0.75rem; color: var(--accent-primary); font-weight: 500; margin-top: 2px;">
                            ${appeal.submittedBy}
                        </div>
                        <div style="font-size: 0.75rem; color: var(--success); margin-top: 2px;">
                            <i class="fas fa-phone-alt" style="font-size: 0.7rem;"></i> ${appeal.phone}
                        </div>
                    </div>
                </div>
            </td>
            <td style="font-weight: 500; color: var(--text-main);">${appeal.programName}</td>
            <td>
                <div class="appeal-reason-box" title="Click row to view full reason">
                    <i class="fas fa-quote-left" style="font-size: 0.7rem; opacity: 0.3; margin-right: 4px;"></i>
                    ${appeal.reason.length > 80 ? appeal.reason.substring(0, 80) + '...' : appeal.reason}
                </div>
            </td>
            <td>
                <span class="appeal-status-badge" style="background: ${statusColor}15; color: ${statusColor}; border: 1px solid ${statusColor}30;">
                    <i class="fas ${getStatusIcon(appeal.status)}"></i>
                    ${(appeal.status || 'pending').replace('_', ' ')}
                </span>
            </td>
            <td style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.4;">
                ${dateStr.split(', ')[0]}<br>
                <span style="opacity: 0.6;">${dateStr.split(', ')[1] || ''}</span>
            </td>
            <td>
                <div class="appeal-action-buttons">
                    <select onchange="updateAppealStatus('${appeal.id}', this.value)" class="input-pill" style="padding: 0.35rem 0.75rem; font-size: 0.75rem; width: auto; flex: 1;">
                        <option value="pending" ${appeal.status === 'pending' ? 'selected' : ''}>Pending</option>
                        <option value="under_review" ${appeal.status === 'under_review' ? 'selected' : ''}>Review</option>
                        <option value="approved" ${appeal.status === 'approved' ? 'selected' : ''}>Approve</option>
                        <option value="rejected" ${appeal.status === 'rejected' ? 'selected' : ''}>Reject</option>
                        <option value="needs_info" ${appeal.status === 'needs_info' ? 'selected' : ''}>Info</option>
                    </select>
                </div>
                <div class="appeal-action-buttons">
                    <button onclick="event.stopPropagation(); setPriority('${appeal.id}', 'high')" class="btn-action-icon" style="${priority === 'high' ? 'background: rgba(239, 68, 68, 0.2); color: #ef4444; border-color: rgba(239, 68, 68, 0.3);' : ''}" title="Flag High Priority">
                        <i class="fas fa-flag"></i>
                    </button>
                    <button onclick="event.stopPropagation(); deleteAppeal('${appeal.id}')" class="btn-action-icon danger" title="Delete Appeal">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
};

const getStatusIcon = (status) => {
    switch (status) {
        case 'pending': return 'fa-clock';
        case 'under_review': return 'fa-magnifying-glass';
        case 'approved': return 'fa-check-circle';
        case 'rejected': return 'fa-times-circle';
        case 'needs_info': return 'fa-info-circle';
        default: return 'fa-question-circle';
    }
};

const getStatusColor = (status) => {
    switch (status) {
        case 'pending': return '#fbbf24';
        case 'under_review': return '#6366f1';
        case 'approved': return '#10b981';
        case 'rejected': return '#ef4444';
        case 'needs_info': return '#f97316';
        default: return '#94a3b8';
    }
};

window.updateAppealStatus = async (id, newStatus) => {
    try {
        const appeal = allAppeals.find(a => a.id === id);
        const statusHistory = appeal?.statusHistory || [];

        statusHistory.push({
            status: newStatus,
            changedAt: new Date().toISOString(),
            changedBy: auth.currentUser?.email || 'admin',
            notes: `Status changed from ${appeal?.status || 'unknown'} to ${newStatus}`
        });

        await updateDoc(doc(db, "appeals", id), {
            status: newStatus,
            updatedAt: serverTimestamp(),
            statusHistory: statusHistory,
            reviewedBy: auth.currentUser?.email || 'admin',
            reviewedAt: serverTimestamp()
        });
        log(`Updated appeal ${id} status to ${newStatus}`);
        fetchAppeals();
    } catch (error) {
        log("Error updating appeal status:", error);
        alert("Failed to update status: " + error.message);
    }
};

window.setPriority = async (id, priority) => {
    try {
        await updateDoc(doc(db, "appeals", id), {
            priority: priority,
            updatedAt: serverTimestamp()
        });
        log(`Updated appeal ${id} priority to ${priority}`);
        fetchAppeals();
    } catch (error) {
        log("Error updating priority:", error);
        alert("Failed to update priority: " + error.message);
    }
};

window.viewAppealDetails = (appeal) => {
    const modal = document.createElement('div');
    modal.id = 'appeal-details-modal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.85);
        backdrop-filter: blur(12px);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1.5rem;
    `;

    const statusHistory = appeal.statusHistory || [];
    const statusColor = getStatusColor(appeal.status);

    const closeModal = () => {
        const modalEl = document.getElementById('appeal-details-modal');
        if (modalEl) {
            modalEl.style.opacity = '0';
            setTimeout(() => modalEl.remove(), 200);
        }
    };

    modal.innerHTML = `
        <div style="background: var(--bg-deep); border: 1px solid var(--glass-border); border-radius: 1.5rem; padding: 2.5rem; max-width: 800px; width: 100%; max-height: 90vh; overflow-y: auto; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); animation: zoomIn 0.3s ease-out;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2.5rem;">
                <div>
                    <h2 style="font-family: var(--font-heading); font-size: 1.75rem; margin: 0; color: #fff; letter-spacing: -0.02em;">Appeal Case Details</h2>
                    <p style="color: var(--text-muted); font-size: 0.85rem; margin-top: 4px;">ID: ${appeal.id}</p>
                </div>
                <button id="close-modal-x" class="btn-action-icon" style="width: 42px; height: 42px; font-size: 1.25rem;">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            
            <div class="appeal-student-details-grid">
                <div class="appeal-detail-item">
                    <div class="label">Student Name</div>
                    <div class="value" style="font-size: 1.1rem;">${appeal.studentName}</div>
                </div>
                <div class="appeal-detail-item">
                    <div class="label">Chest Number</div>
                    <div class="value">${appeal.chestNumber}</div>
                </div>
                <div class="appeal-detail-item">
                    <div class="label">Department</div>
                    <div class="value">${appeal.department}</div>
                </div>
                <div class="appeal-detail-item">
                    <div class="label">Competition Program</div>
                    <div class="value" style="color: var(--accent-primary);">${appeal.programName}</div>
                </div>
                <div class="appeal-detail-item">
                    <div class="label">Contact Info</div>
                    <div class="value"><i class="fas fa-phone-alt"></i> ${appeal.phone}</div>
                </div>
                <div class="appeal-detail-item">
                    <div class="label">Submitted By</div>
                    <div class="value" style="font-size: 0.85rem; opacity: 0.8;">${appeal.submittedBy}</div>
                </div>
            </div>

            <div style="margin-bottom: 2rem;">
                <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 1rem;">Process Status</div>
                <div style="display: flex; align-items: center; gap: 1.5rem;">
                    <span class="appeal-status-badge" style="background: ${statusColor}15; color: ${statusColor}; border: 1px solid ${statusColor}30; padding: 0.75rem 1.5rem; font-size: 0.9rem;">
                        <i class="fas ${getStatusIcon(appeal.status)}" style="font-size: 1.1rem;"></i>
                        ${(appeal.status || 'pending').toUpperCase()}
                    </span>
                    <div style="color: var(--text-muted); font-size: 0.85rem;">
                        <i class="fas fa-flag" style="color: ${appeal.priority === 'high' ? 'var(--error)' : 'var(--warning)'}"></i>
                        Priority: ${(appeal.priority || 'medium').toUpperCase()}
                    </div>
                </div>
            </div>
            
            <div style="margin-bottom: 2.5rem;">
                <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 1rem;">Reason & Arguments</div>
                <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--glass-border); padding: 1.5rem; border-radius: 1rem; color: var(--text-main); line-height: 1.7; font-size: 0.95rem; white-space: pre-wrap; word-break: break-all; overflow-wrap: anywhere;">${appeal.reason}</div>
            </div>

            ${appeal.videoUrl ? `
                <div style="margin-bottom: 2.5rem;">
                    <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 1rem;">Video Evidence</div>
                    <div style="aspect-ratio: 16/9; background: #000; border-radius: 1rem; overflow: hidden; border: 1px solid var(--glass-border);">
                        <iframe width="100%" height="100%" src="${appeal.videoUrl.replace('watch?v=', 'embed/')}" frameborder="0" allowfullscreen></iframe>
                    </div>
                </div>
            ` : ''}
            
            ${statusHistory.length > 0 ? `
                <div style="margin-bottom: 2.5rem;">
                    <div style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 1rem;">Activity Log</div>
                    <div style="display: flex; flex-direction: column; gap: 1rem;">
                        ${statusHistory.map(h => {
        const hColor = getStatusColor(h.status);
        return `
                                <div style="padding: 1rem; background: rgba(255,255,255,0.02); border-left: 3px solid ${hColor}; border-radius: 0.5rem;">
                                    <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.5rem;">
                                        <span style="font-weight: 700; color: ${hColor}; font-size: 0.75rem; text-transform: uppercase;">${h.status.replace('_', ' ')}</span>
                                        <span style="font-size: 0.7rem; color: var(--text-muted);">${new Date(h.changedAt).toLocaleString()}</span>
                                    </div>
                                    <div style="font-size: 0.85rem; color: var(--text-secondary);">${h.notes}</div>
                                    <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 4px; font-style: italic;">Changed by: ${h.changedBy}</div>
                                </div>
                            `;
    }).join('')}
                    </div>
                </div>
            ` : ''}
            
            <div style="display: flex; gap: 1.5rem;">
                <button id="close-modal-btn" class="btn-tab active" style="flex: 1; padding: 1.25rem; font-size: 1rem;">
                    Close Case Record
                </button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    // Add event listeners after modal is in DOM
    document.getElementById('close-modal-x').onclick = closeModal;
    document.getElementById('close-modal-btn').onclick = closeModal;
    modal.onclick = (e) => {
        if (e.target === modal) closeModal();
    };
};

window.deleteAppeal = async (id) => {
    if (!confirm("Are you sure you want to permanently delete this appeal?")) return;
    try {
        await deleteDoc(doc(db, "appeals", id));
        log(`Deleted appeal ${id}`);
        fetchAppeals();
    } catch (error) {
        log("Error deleting appeal:", error);
        alert("Failed to delete appeal: " + error.message);
    }
};
