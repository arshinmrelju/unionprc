# Union Arts PRC

A professional management portal and appeal system for the Union Arts Arts Festival, built with a modern glassmorphic aesthetic and real-time Firebase backend.

## 🚀 Features

- **Admin Dashboard**: Comprehensive control panel for managing students, programs, scores, and system settings.
- **Appeal Portal**: A dedicated, user-friendly interface for participants to submit appeals with video evidence support.
- **Real-time Leaderboard**: Live-updating results and department-wise standings.
- **Access Control**: Secure authentication with whitelisted access for administrators and teachers.
- **Registration Management**: Tools for field-level control, chest number drawing, and registration locking.
- **Program Scheduling**: Dynamic management of competition dates and schedules.

## 🛠️ Technology Stack

- **Frontend**: HTML5, Vanilla JavaScript, CSS3 (Glassmorphism)
- **Backend**: Firebase (Firestore, Authentication, Hosting)
- **Icons**: Font Awesome 6
- **Typography**: Outfit & Inter (Google Fonts)

## 📁 Project Structure

- `/y`: The public web directory containing the application files.
  - `index.html`: Main landing page and dashboard.
  - `admin.html`: Unified administration console.
  - `appeal.html`: Participant appeal submission portal.
  - `leaderboard.html`: Public results and standings page.
  - `/assets`: CSS, JS, and image assets organized by section (core, admin, etc.).
- `firebase.json`: Configuration for Firebase Hosting and rules.
- `firestore.rules`: Security rules for Firestore data access.
- `package.json`: Project metadata and dependencies.

## 🔧 Installation & Deployment

1. **Clone the repository**:
   ```bash
   git clone [repository-url]
   ```
2. **Setup Firebase**:
   Ensure you have the Firebase CLI installed and are logged in. Initialize the project with your Firebase project ID.
3. **Deploy to Firebase**:
   ```bash
   firebase deploy
   ```

## 📄 License

This project is developed for the Union Arts PRC. All rights reserved.
