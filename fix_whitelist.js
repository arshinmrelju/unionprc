const admin = require('firebase-admin');

// IMPORTANT: Replace the path with the actual service account key path if needed
// Or set GOOGLE_APPLICATION_CREDENTIALS environment variable
const serviceAccountPath = process.env.SERVICE_ACCOUNT || './serviceAccountKey.json';

try {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
} catch (e) {
    console.error("Could not find service account at " + serviceAccountPath);
    console.error("Please provide it via SERVICE_ACCOUNT env var or place it at ./serviceAccountKey.json");
    process.exit(1);
}

const db = admin.firestore();

const DEPT_COURSES = {
    "Dep. of Economics": ["B.A Economics", "B.A Econometrics and Data Management", "M.A Economics"],
    "Dep. of English": ["B.A English Language and Literature"],
    "Dep. of History": ["B.A History"],
    "Dep. of Microbiology": ["B.Sc Microbiology", "M.Sc Microbiology"],
    "Dep. of Travel and Tourism": ["Bachelor of Travel and Tourism Management (BTTM)", "Master of Travel and Tourism Management (MTTM)"],
    "Dep. of Journalism and Mass Communication": ["B.A Journalism and Mass Communication", "M.A Journalism & Mass Communication"],
    "Dep. of Biochemistry": ["B.Sc Biochemistry", "M.Sc Biochemistry"],
    "Dep. of Commerce": ["BBA", "M.COM"]
};

async function fixWhitelist() {
    console.log("Starting whitelist fix...");
    const snapshot = await db.collection('whitelisted_emails').get();
    
    if (snapshot.empty) {
        console.log("No whitelist entries found.");
        return;
    }

    const batch = db.batch();
    let count = 0;

    snapshot.forEach(doc => {
        const data = doc.data();
        let { department, role, allowedCourses } = data;
        let updated = false;

        // Skip Main Admin and Global Leaderboard
        if (department === "Main Admin" || department === "Global Leaderboard" || role === "Leaderboard") {
            return;
        }

        // 1. Fix department name if missing "Dep. of "
        if (department && !department.startsWith("Dep. of ")) {
            const fullDept = "Dep. of " + department;
            if (DEPT_COURSES[fullDept]) {
                console.log(`Fixing department for ${data.email}: ${department} -> ${fullDept}`);
                department = fullDept;
                updated = true;
            } else {
                console.warn(`Unknown department for ${data.email}: ${department}`);
            }
        }

        // 2. Re-populate allowedCourses if department is valid
        if (department && DEPT_COURSES[department]) {
            const newAllowed = DEPT_COURSES[department];
            if (JSON.stringify(allowedCourses) !== JSON.stringify(newAllowed)) {
                console.log(`Updating allowedCourses for ${data.email} (${department})`);
                allowedCourses = newAllowed;
                updated = true;
            }
        }

        if (updated) {
            batch.update(doc.ref, { department, allowedCourses });
            count++;
        }
    });

    if (count > 0) {
        await batch.commit();
        console.log(`Successfully updated ${count} entries.`);
    } else {
        console.log("No entries needed updates.");
    }
}

fixWhitelist().then(() => {
    console.log("Done.");
    process.exit(0);
}).catch(err => {
    console.error("Error fixing whitelist:", err);
    process.exit(1);
});
