import { initializeApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import { getFirestore, collection, addDoc, serverTimestamp, doc, getDoc, query, where, getDocs, limit } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import { firebaseConfig } from "../core/firebase-config.js";
import { initCustomSelects } from "./custom-select.js";

// Config imported above

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let currentUser = null;
let systemYear = "2025-26";
let nameToChestMap = {}; // Local map for Name -> Chest Number lookup

const DEPT_COURSES = {
    "Dep. of Economics": ["Dep. of Economics", "B.A Economics", "B.A Econometrics and Data Management", "M.A Economics"],
    "Dep. of English": ["Dep. of English", "B.A English Language and Literature"],
    "Dep. of History": ["Dep. of History", "B.A History"],
    "Dep. of Microbiology": ["Dep. of Microbiology", "B.Sc Microbiology", "M.Sc Microbiology"],
    "Dep. of Travel and Tourism": ["Dep. of Travel and Tourism", "Bachelor of Travel and Tourism Management (BTTM)", "Master of Travel and Tourism Management (MTTM)", "Tourism"],
    "Dep. of Journalism and Mass Communication": ["Dep. of Journalism and Mass Communication", "B.A Journalism and Mass Communication", "M.A Journalism & Mass Communication"],
    "Dep. of Biochemistry": ["Dep. of Biochemistry", "B.Sc Biochemistry", "M.Sc Biochemistry"],
    "Dep. of Commerce": ["Dep. of Commerce", "B.Com", "M.Com", "BBA"]
};

// Toast System - Premium Version
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icon = type === 'success' ? 'fa-check-double' : 'fa-triangle-exclamation';
    toast.innerHTML = `
        <i class="fas ${icon}" style="color: ${type === 'success' ? 'var(--success)' : 'var(--error)'}; font-size: 1.25rem;"></i>
        <div style="display: flex; flex-direction: column;">
            <span style="font-weight: 700; font-size: 0.9rem; letter-spacing: 0.02em;">${type.toUpperCase()}</span>
            <span style="font-size: 0.95rem; opacity: 0.9;">${message}</span>
        </div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.transform = 'translateX(120%)';
        toast.style.opacity = '0';
        toast.style.transition = 'all 0.5s cubic-bezier(0.16, 1, 0.3, 1)';
        setTimeout(() => toast.remove(), 500);
    }, 4500);
}

// Elements
const loading = document.getElementById('loading');
const authSection = document.getElementById('auth-section');
const formSection = document.getElementById('form-section');
const successSection = document.getElementById('success-section');
const appealForm = document.getElementById('appeal-form');
const userDisplay = document.getElementById('user-display');
const loginBtn = document.getElementById('google-login-btn');
const logoutBtn = document.getElementById('logout-btn');
const phoneInput = document.getElementById('contact-phone');

function toggleLoading(show) {
    if (show) loading.classList.remove('hidden');
    else loading.classList.add('hidden');
}

async function populatePrograms(department) {
    const programSelect = document.getElementById('program-name');
    const nameSelect = document.getElementById('student-name');
    const chestInput = document.getElementById('chest-number');

    // Clear downstream
    programSelect.innerHTML = '<option value="" disabled selected>Select Department First</option>';
    programSelect.disabled = true;
    nameSelect.innerHTML = '<option value="" disabled selected>Select Program First</option>';
    nameSelect.disabled = true;
    chestInput.value = '';
    nameToChestMap = {};

    if (!department) return;

    programSelect.innerHTML = '<option value="" disabled selected>Loading programs...</option>';

    try {
        let q;
        if (department === "Others") {
            q = query(collection(db, "registrations"), where("academicYear", "==", systemYear), limit(100));
        } else {
            const allowedValues = DEPT_COURSES[department] || [department];
            q = query(collection(db, "registrations"), where("department", "in", allowedValues), where("academicYear", "==", systemYear));
        }

        const querySnapshot = await getDocs(q);
        const programs = new Set();
        querySnapshot.forEach(doc => {
            const data = doc.data();
            if (data.program) programs.add(data.program);
        });

        programSelect.innerHTML = '<option value="" disabled selected>Select Program</option>';
        if (programs.size === 0) {
            programSelect.innerHTML = '<option value="" disabled selected>No programs found</option>';
        } else {
            Array.from(programs).sort().forEach(p => {
                const opt = document.createElement('option');
                opt.value = p; opt.textContent = p;
                programSelect.appendChild(opt);
            });
            programSelect.disabled = false;
        }
    } catch (e) {
        console.error("Program fetch failed:", e);
        programSelect.innerHTML = '<option value="" disabled selected>Error loading</option>';
    }
}

async function populateNames(department, program) {
    const nameSelect = document.getElementById('student-name');
    const chestInput = document.getElementById('chest-number');

    // Clear downstream
    nameSelect.innerHTML = '<option value="" disabled selected>Loading names...</option>';
    nameSelect.disabled = true;
    chestInput.value = '';
    nameToChestMap = {};

    try {
        let q;
        if (department === "Others") {
            q = query(collection(db, "registrations"), where("program", "==", program), where("academicYear", "==", systemYear));
        } else {
            const allowedValues = DEPT_COURSES[department] || [department];
            q = query(collection(db, "registrations"),
                where("department", "in", allowedValues),
                where("program", "==", program),
                where("academicYear", "==", systemYear)
            );
        }

        const querySnapshot = await getDocs(q);
        const names = [];
        querySnapshot.forEach(doc => {
            const data = doc.data();
            const name = data.studentName || data.groupName;
            if (name) {
                names.push(name);
                nameToChestMap[name] = {
                    chest: data.chestNumber || "Pending",
                    videoUrl: data.videoUrl || null,
                    youtubeId: data.youtubeId || null
                };
                if (data.videoUrl) console.log(`[Debug] Video found for ${name}:`, data.videoUrl);
            }
        });

        nameSelect.innerHTML = '<option value="" disabled selected>Select Name</option>';
        if (names.length === 0) {
            nameSelect.innerHTML = '<option value="" disabled selected>No registrations found</option>';
        } else {
            names.sort().forEach(n => {
                const opt = document.createElement('option');
                opt.value = n; opt.textContent = n;
                nameSelect.appendChild(opt);
            });
            nameSelect.disabled = false;
        }
    } catch (e) {
        console.error("Name fetch failed:", e);
        nameSelect.innerHTML = '<option value="" disabled selected>Error loading</option>';
    }
}

document.getElementById('department').addEventListener('change', (e) => {
    e.target.setAttribute('value', e.target.value);
    e.target.classList.toggle('has-value', e.target.value !== "");
    populatePrograms(e.target.value);
});
document.getElementById('program-name').addEventListener('change', (e) => {
    e.target.setAttribute('value', e.target.value);
    e.target.classList.toggle('has-value', e.target.value !== "");
    const dept = document.getElementById('department').value;
    populateNames(dept, e.target.value);
});
document.getElementById('student-name').addEventListener('change', (e) => {
    e.target.setAttribute('value', e.target.value);
    e.target.classList.toggle('has-value', e.target.value !== "");

    const data = nameToChestMap[e.target.value] || {};
    console.log(`[Debug] Selected ${e.target.value}:`, data);
    document.getElementById('chest-number').value = data.chest || '';

    // Video Evidence Logic
    const videoContainer = document.getElementById('video-evidence-container');
    const videoWrapper = document.getElementById('video-wrapper');
    const iframe = document.getElementById('evidence-frame');
    const noVideoMessage = document.getElementById('no-video-message');

    if (data.videoUrl && data.youtubeId) {
        console.log("Showing video evidence");
        iframe.src = `https://www.youtube.com/embed/${data.youtubeId}`;

        videoContainer.classList.remove('hidden');
        videoWrapper.classList.remove('hidden');
        noVideoMessage.classList.add('hidden');
    } else {
        console.log("No video evidence to show");
        iframe.src = '';

        videoContainer.classList.remove('hidden'); // Always show container to frame the message
        videoWrapper.classList.add('hidden');
        noVideoMessage.classList.remove('hidden');
    }
});

function updateJourney(stepId) {
    const steps = ['verify', 'draft', 'submit'];
    const currentIdx = steps.indexOf(stepId);

    steps.forEach((step, idx) => {
        const el = document.getElementById(`step-${step}`);
        if (idx < currentIdx) {
            el.classList.add('completed');
            el.classList.remove('active');
        } else if (idx === currentIdx) {
            el.classList.add('active');
            el.classList.remove('completed');
        } else {
            el.classList.remove('active', 'completed');
        }
    });
}

// Character Counter
const reasonTextarea = document.getElementById('appeal-reason');
const charCounter = document.getElementById('char-count');

reasonTextarea.addEventListener('input', () => {
    const count = reasonTextarea.value.length;
    charCounter.textContent = count;
    if (count >= 1000) {
        charCounter.style.color = 'var(--error)';
        charCounter.style.opacity = '1';
    } else {
        charCounter.style.color = 'var(--text-dim)';
        charCounter.style.opacity = '0.6';
    }
});

// Phone Validation & Formatting
phoneInput.addEventListener('input', (e) => {
    let value = e.target.value.replace(/\D/g, '');
    value = value.substring(0, 10);
    e.target.value = value;

    if (value.length > 0 && value.length < 10) {
        e.target.parentElement.style.setProperty('--primary', 'var(--error)');
        e.target.style.borderColor = 'rgba(239, 68, 68, 0.3)';
    } else if (value.length === 10) {
        e.target.parentElement.style.setProperty('--primary', 'var(--success)');
        e.target.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    } else {
        e.target.parentElement.style.setProperty('--primary', '#6366f1');
        e.target.style.borderColor = 'rgba(255, 255, 255, 0.08)';
    }
});

// Fetch System Year
async function fetchSystemYear() {
    try {
        const docRef = doc(db, "system_config", "current_year");
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            systemYear = docSnap.data().year || "2025-26";
        }
    } catch (e) {
        console.error("Year fetch failed:", e);
    }
}

fetchSystemYear();

// Auto-assign department based on email
async function autoAssignDepartment(email) {
    const deptField = document.getElementById('department');
    if (deptField.value) return;

    try {
        const emailLower = email.toLowerCase();
        const yearScopedId = `${emailLower}_${systemYear}`;
        const whitelistRef = doc(db, "whitelisted_emails", yearScopedId);
        const whitelistSnap = await getDoc(whitelistRef);

        if (whitelistSnap.exists() && whitelistSnap.data().department) {
            deptField.value = whitelistSnap.data().department;
            deptField.setAttribute('value', deptField.value);
            deptField.classList.add('has-value');
            populatePrograms(deptField.value);
            return;
        }

        const regQuery = query(
            collection(db, "registrations"),
            where("registeredBy", "==", emailLower),
            where("academicYear", "==", systemYear),
            limit(1)
        );
        const regSnap = await getDocs(regQuery);

        if (!regSnap.empty) {
            const data = regSnap.docs[0].data();
            if (data.department) {
                const options = Array.from(deptField.options).map(opt => opt.value);
                if (options.includes(data.department)) {
                    deptField.value = data.department;
                } else {
                    for (const [dept, courses] of Object.entries(DEPT_COURSES)) {
                        if (courses.includes(data.department) || data.department.includes(dept)) {
                            deptField.value = dept;
                            break;
                        }
                    }
                }
                deptField.setAttribute('value', deptField.value);
                deptField.classList.toggle('has-value', deptField.value !== "");
                if (deptField.value) populatePrograms(deptField.value);
            }
        }
    } catch (error) {
        console.error("Auto-assign department failed:", error);
    }
}

// Auth Logic
loginBtn.onclick = async () => {
    const provider = new GoogleAuthProvider();
    try {
        toggleLoading(true);
        await signInWithPopup(auth, provider);
        showToast("Access Granted. Session Initialized.", "success");
    } catch (error) {
        showToast(error.message, 'error');
    } finally {
        toggleLoading(false);
    }
};

logoutBtn.onclick = async () => {
    try {
        toggleLoading(true);
        await signOut(auth);
        showToast("Session Terminated.", "success");
    } catch (e) {
        showToast(e.message, 'error');
    } finally {
        toggleLoading(false);
    }
};

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        userDisplay.textContent = user.email;
        authSection.classList.add('hidden');
        formSection.classList.remove('hidden');
        successSection.classList.add('hidden');
        updateJourney('draft');

        const params = new URLSearchParams(window.location.search);
        const fields = ['department', 'program-name', 'student-name', 'chest-number', 'contact-phone'];
        const paramKeys = ['dept', 'program', 'name', 'chest', 'phone'];

        paramKeys.forEach((key, index) => {
            if (params.has(key)) {
                const field = document.getElementById(fields[index]);
                if (field.tagName === 'SELECT') {
                    // Note: Cascading selects handle their own population via listeners
                } else {
                    field.value = params.get(key);
                }
            }
        });

        await autoAssignDepartment(user.email);
    } else {
        currentUser = null;
        authSection.classList.remove('hidden');
        formSection.classList.add('hidden');
        successSection.classList.add('hidden');
        updateJourney('verify');
    }
});

// Cursor Tracking Effect for Cards
document.addEventListener('mousemove', (e) => {
    document.querySelectorAll('.card').forEach(card => {
        const rect = card.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        card.style.setProperty('--x', `${x}px`);
        card.style.setProperty('--y', `${y}px`);
    });
});

// Check for duplicate appeals
async function checkDuplicateAppeal(programName, userEmail) {
    try {
        const q = query(
            collection(db, "appeals"),
            where("programName", "==", programName),
            where("submittedBy", "==", userEmail),
            where("academicYear", "==", systemYear)
        );
        const querySnapshot = await getDocs(q);
        return !querySnapshot.empty;
    } catch (error) {
        console.error("Duplicate check failed:", error);
        return false;
    }
}

// Show confirmation dialog
function showConfirmationDialog(formData) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.8);
            backdrop-filter: blur(10px);
            z-index: 9999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 1rem;
        `;

        const modal = document.createElement('div');
        modal.style.cssText = `
            background: linear-gradient(135deg, rgba(15, 23, 42, 0.95) 0%, rgba(15, 23, 42, 0.9) 100%);
            backdrop-filter: blur(30px);
            border: 1.5px solid rgba(255, 255, 255, 0.15);
            border-radius: 1.5rem;
            padding: 2.5rem;
            max-width: 500px;
            width: 100%;
            box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        `;

        modal.innerHTML = `
            <div style="text-align: center; margin-bottom: 2rem;">
                <div style="width: 60px; height: 60px; background: linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%); border-radius: 1rem; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem; box-shadow: 0 10px 20px -3px var(--primary-glow);">
                    <i class="fas fa-exclamation-triangle" style="font-size: 1.8rem; color: #fff;"></i>
                </div>
                <h2 style="font-family: var(--font-outfit); font-size: 1.5rem; margin-bottom: 0.5rem; color: #fff;">Confirm Appeal Submission</h2>
                <p style="color: var(--text-dim); font-size: 0.9rem;">Please review your appeal details before submitting</p>
            </div>
            
            <div style="background: rgba(0, 0, 0, 0.3); border: 1px solid var(--glass-border); border-radius: 1rem; padding: 1.5rem; margin-bottom: 2rem;">
                <div style="margin-bottom: 1rem;">
                    <div style="font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">Student Name</div>
                    <div style="font-weight: 600; color: #fff;">${formData.studentName}</div>
                </div>
                <div style="margin-bottom: 1rem;">
                    <div style="font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">Program</div>
                    <div style="font-weight: 600; color: var(--primary-light);">${formData.programName}</div>
                </div>
                <div style="margin-bottom: 1rem;">
                    <div style="font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">Department</div>
                    <div style="font-weight: 500; color: #fff;">${formData.department}</div>
                </div>
                <div>
                    <div style="font-size: 0.75rem; color: var(--text-dim); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem;">Reason</div>
                    <div style="font-size: 0.9rem; color: var(--text-dim); line-height: 1.5; max-height: 100px; overflow-y: auto;">${formData.reason.substring(0, 200)}${formData.reason.length > 200 ? '...' : ''}</div>
                </div>
            </div>
            
            <div style="display: flex; gap: 1rem;">
                <button id="cancel-btn" style="flex: 1; background: rgba(255, 255, 255, 0.05); color: var(--text-dim); border: 1px solid var(--glass-border); border-radius: 0.75rem; padding: 1rem; font-size: 1rem; font-weight: 600; cursor: pointer; transition: all 0.3s;">
                    Cancel
                </button>
                <button id="confirm-btn" style="flex: 1; background: linear-gradient(135deg, var(--primary) 0%, var(--primary-light) 100%); color: #fff; border: none; border-radius: 0.75rem; padding: 1rem; font-size: 1rem; font-weight: 600; cursor: pointer; transition: all 0.3s; box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.3);">
                    Submit Appeal
                </button>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        modal.querySelector('#cancel-btn').onclick = () => {
            document.body.removeChild(overlay);
            resolve(false);
        };

        modal.querySelector('#confirm-btn').onclick = () => {
            document.body.removeChild(overlay);
            resolve(true);
        };

        overlay.onclick = (e) => {
            if (e.target === overlay) {
                document.body.removeChild(overlay);
                resolve(false);
            }
        };
    });
}

// Form Submission
appealForm.onsubmit = async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    const phone = phoneInput.value.trim();
    if (phone.length !== 10) {
        showToast("Valid 10-digit contact required.", "error");
        return;
    }

    const reason = document.getElementById('appeal-reason').value.trim();
    if (reason.length < 50) {
        showToast("Please provide a detailed reason (minimum 50 characters).", "error");
        return;
    }

    const formData = {
        studentName: document.getElementById('student-name').value,
        chestNumber: document.getElementById('chest-number').value,
        department: document.getElementById('department').value,
        programName: document.getElementById('program-name').value,
        reason: reason,
        phone: phone,
        status: 'pending',
        priority: 'medium',
        academicYear: systemYear,
        submittedAt: serverTimestamp(),
        submittedBy: currentUser.email,
        uid: currentUser.uid,
        statusHistory: [{
            status: 'pending',
            changedAt: new Date().toISOString(),
            changedBy: 'system',
            notes: 'Appeal submitted'
        }]
    };

    try {
        toggleLoading(true);

        // Check for duplicate appeals
        const hasDuplicate = await checkDuplicateAppeal(formData.programName, currentUser.email);
        if (hasDuplicate) {
            toggleLoading(false);
            const proceed = confirm(`You have already submitted an appeal for "${formData.programName}". Do you want to submit another appeal for the same program?`);
            if (!proceed) return;
            toggleLoading(true);
        }

        // Show confirmation dialog
        const confirmed = await showConfirmationDialog(formData);
        if (!confirmed) {
            toggleLoading(false);
            return;
        }

        const docRef = await addDoc(collection(db, "appeals"), formData);

        document.getElementById('ref-id').textContent = docRef.id;
        formSection.classList.add('hidden');
        successSection.classList.remove('hidden');
        updateJourney('submit');
        showToast("Appeal Transmitted Successfully", "success");
    } catch (error) {
        console.error("Submission error:", error);
        showToast("Encrypted transmission failed: " + error.message, 'error');
    } finally {
        toggleLoading(false);
    }
};


// Initialize custom dropdowns
document.addEventListener('DOMContentLoaded', () => {
    initCustomSelects();
});

// Also re-init when needed if dynamic content is added, though MutationObserver in CustomSelect handles options changes.
// We might need to handle cases where entirely new selects are added to DOM.
// For now, the structure is static regarding the number of selects.
