# SKILL MOUNTAIN ACADEMY
## Learning Management System (LMS) – Dashboard Structure, Features & Functional Requirements

### 1. PLATFORM OVERVIEW

The Skill Mountain Academy platform should operate as a modern, interactive, secure, and highly personalized digital learning environment.

The goal is to create an experience that feels like a personal homeschool environment, where every student has a dedicated instructor, a structured learning timetable, access to learning materials, assignments, assessments, and an AI-powered learning assistant.

The platform will have three distinct dashboard environments:

1. **Student Dashboard** – For students to access their learning environment, attend live classes, complete assignments, take quizzes, monitor progress, and communicate with their instructors.
2. **Instructor Dashboard** – For instructors to manage their assigned programmes, monitor students, conduct live classes, assess assignments, and track student performance.
3. **Administrator Dashboard** – For administrators to oversee the entire academy, manage users, monitor academic performance, track payments, supervise instructors, and manage the overall platform.

All three dashboards must be connected to a centralized backend with clearly defined user roles and permissions.

---

# 2. STUDENT DASHBOARD

The student dashboard should be divided into three primary sections: Left Panel, Central Learning Workspace, and Right Panel.

### A. LEFT PANEL – LEARNING ACTIVITIES

This section should provide students with quick access to everything they need to do academically.

It should include:

**1. Weekly Assignments**
- Display assignments given to the student for the current week.
- Show assignment titles, descriptions, deadlines, and submission status.
- Allow students to upload completed assignments.
- Display pending, submitted, overdue, and graded assignments.

**2. Personal Quizzes**
- Provide access to quizzes assigned specifically to the student.
- Display quiz instructions, duration, deadlines, and completion status.
- Record quiz scores automatically where applicable.

**3. Graded Quizzes and Assessments**
- Allow students to access graded assessments.
- Display completed assessments, scores, feedback, and performance history.

**4. Learning Resources**
- Provide access to course materials, training videos, documents, practical exercises, and other approved learning resources.

The left panel should make it immediately clear what the student needs to learn, complete, or submit.

### B. CENTRAL SECTION – LIVE LEARNING WORKSPACE

This is the primary learning environment and should receive the most visual attention on the student dashboard.

It should contain three major components:

**1. Live Class and Video Conferencing**

The central workspace should integrate Google Meet for instructor-led, one-on-one live training sessions.

Each student will have one scheduled interactive session with their assigned instructor every week.

- Each session should last between 45 minutes and one hour.
- Students should have a fixed weekly timetable.
- For example, if a student selects Monday, 10:00 AM–10:45 AM, that becomes their recurring weekly class schedule.
- Students should not be able to independently change their confirmed recurring timetable.
- Any timetable modification must go through an authorized administrative process.

**Recurring Session Management:**

The system must distinguish between the student's fixed weekly timetable and individual session records.

The recurring timetable determines when the student is expected to attend class every week. Individual session records track each actual class, including its date, instructor, meeting link, attendance, and completion status.

This separation is important to prevent accidental changes to the student's permanent weekly schedule when managing individual classes.

**Meeting Link Creation and Management:**

The instructor must be responsible for creating and managing their Google Meet links.

The workflow should operate as follows:

1. The instructor logs into their dashboard.
2. The instructor views their scheduled one-on-one sessions.
3. For each upcoming session, the instructor creates a Google Meet link.
4. The instructor adds the meeting link to the corresponding session on their dashboard.
5. The system automatically associates that link with the correct student, instructor, course, and session record.
6. The platform sends the meeting link to the assigned student through their dashboard notifications and registered email.
7. As the session approaches, the platform sends automatic reminders to both the student and instructor.
8. When it is time for the session, the student can click the meeting link directly from their dashboard to join the class.

The instructor should also be able to update or replace a meeting link when necessary.

**Important Access Restrictions:**
- Students must only have access to their assigned meeting links.
- Instructors must only have access to sessions assigned to them.
- Administrators should have appropriate oversight and access based on their permissions.
- Meeting links must never be publicly accessible or exposed to unauthorized users.

**2. Interactive Whiteboard and Screen Sharing**

The live learning workspace should support an interactive teaching environment.

Features should include:
- Live video conferencing.
- Full-screen video viewing.
- Screen sharing by the instructor.
- Screen sharing by the student when requested by the instructor.
- Interactive whiteboard for explanations, illustrations, demonstrations, and practical teaching.
- Ability to display training videos and other learning materials.

For practical courses such as graphic design, web development, and other digital skills, students must be able to share their screens so instructors can observe their work and provide real-time guidance.

The instructor should be able to demonstrate processes, guide students through software interfaces, identify mistakes, and explain how to complete tasks correctly.

**3. AI-Powered Learning Assistant**

Directly below or alongside the central learning workspace, there should be an AI chatbot interface.

This assistant should function as a personal academic support system, helping students understand their lessons and improve their learning experience.

However, it must not operate as a generic chatbot.

The AI assistant must be connected to:
- The student's enrolled programme.
- The specific course the student is studying.
- Approved course materials.
- Training documents and resources.
- Relevant lessons and learning objectives.

Its responsibilities should include:
- Explaining difficult concepts.
- Answering questions about lessons.
- Providing additional examples.
- Helping students understand assignments.
- Guiding students through practical exercises.
- Supporting revision and preparation for assessments.
- Recommending relevant learning materials.
- Helping students identify areas where they need improvement.

The AI should act as a learning companion, not a replacement for the human instructor.

### C. RIGHT PANEL – STUDENT PROFILE AND PERFORMANCE

The right-hand section should display the student's personal information, academic records, payment information, and learning progress.

It should contain:

**1. Student Profile**
- Profile picture.
- Full name.
- Student ID.
- Basic biography and personal information.
- Contact information.

**2. Enrolled Programme**
- Programme name.
- Enrolled courses.
- Programme duration.
- Registration date.
- Assigned instructor.

**3. Payment Information**

The dashboard should display the student's payment status, including:
- Selected payment plan.
- One-time payment or instalment arrangement.
- Total programme fee.
- Amount paid.
- Outstanding balance, where applicable.
- Payment history.
- Payment status.

**4. Academic Grades**

Students should be able to see their academic performance, including:
- Assignment scores.
- Quiz results.
- Assessment grades.
- Instructor feedback.
- Overall academic performance.

**5. Learning Progress**

Display the student's overall learning progress through visual indicators, progress bars, or charts.

This should include:
- Course completion percentage.
- Lessons completed.
- Assignments submitted.
- Quizzes completed.
- Assessment performance.
- Attendance record.
- Overall programme progress.

---

# 3. INSTRUCTOR DASHBOARD

The instructor dashboard should also be divided into three primary sections: Left Panel, Central Teaching Workspace, and Right Panel.

### A. LEFT PANEL – PROGRAMMES AND STUDENT MANAGEMENT

This section should display all the programmes and courses assigned to the instructor.

Each programme should display:
- Programme name.
- Number of enrolled students.
- Course details.
- Overall student progress.

When an instructor clicks on a particular programme, they should be able to view the students enrolled in that programme.

Clicking on an individual student's profile should reveal:

- Student profile and basic information.
- Enrolled programme and courses.
- Learning progress.
- Lessons completed.
- Assignment submissions.
- Quiz and assessment results.
- Attendance history.
- Learning consistency and engagement.
- Areas where the student needs improvement.

The instructor should be able to monitor each student's academic development and identify students who may require additional attention.

### B. CENTRAL SECTION – INSTRUCTOR TEACHING WORKSPACE

This is the primary teaching area of the instructor dashboard.

**1. Live Teaching Workspace**

The instructor should have access to a teaching environment similar to the student's central workspace.

It should include:
- Google Meet integration.
- Live video conferencing.
- Interactive whiteboard.
- Screen sharing.
- Training material display.
- Full-screen video capability.
- Access to relevant course resources.

The instructor should be able to conduct practical demonstrations and guide students through their learning activities.

**2. Meeting Link Management**

Every instructor is responsible for creating their Google Meet links for scheduled live sessions.

The instructor must be able to:
- View upcoming one-on-one sessions.
- Create a Google Meet link for each session.
- Add the link to the appropriate session record on their dashboard.
- Edit or replace an existing meeting link.
- Confirm that the link has been assigned to the correct student.
- View whether the student has received the meeting notification.

Once a meeting link is added, the platform should automatically notify the assigned student.

**3. Daily Class Schedule and Student Profiles**

Directly below the teaching workspace, there should be a daily schedule showing all the students the instructor is expected to meet.

For example, if an instructor has five students scheduled for Monday, all five students should appear in this section.

The schedule should display:
- Student profile picture.
- Student name.
- Programme or course.
- Scheduled session time.
- Session duration.
- Meeting link status.
- Attendance and session status.

The interface should resemble a calendar or appointment management system.

The instructor should be able to quickly identify who they are teaching next, the scheduled time, and the relevant course.

The schedule should support daily, weekly, and calendar views.

**4. Attendance and Session Tracking**

After every scheduled session, the instructor must be required to record the student's attendance.

The instructor should be able to mark a session as:

- Completed – The student attended and the class was conducted.
- Missed – The student did not attend.
- Cancelled – The session was cancelled.
- Rescheduled – The session was moved through an authorized process.

The system should maintain a record of every individual session.

This is mandatory because it will help administrators monitor instructor accountability, student attendance, and the overall effectiveness of the training programme.

### C. RIGHT PANEL – INSTRUCTOR PROFILE AND PERFORMANCE

This section should display the instructor's professional information and performance records.

It should include:

**1. Instructor Profile**
- Profile picture.
- Full name.
- Professional biography.
- Contact information.
- Areas of specialization.

**2. Professional Achievements**
- Qualifications.
- Certifications.
- Professional experience.
- Notable achievements.
- Portfolio or work samples.

**3. Assigned Courses**
- Courses handled.
- Programmes assigned.
- Number of students under their supervision.

**4. Social Media and Professional Links**
- LinkedIn profile.
- Portfolio website.
- Other relevant professional social media accounts.

**5. Instructor Performance**

The system should track:
- Number of students taught.
- Number of completed sessions.
- Attendance records.
- Student academic improvement.
- Student feedback.
- Student reviews and ratings.
- Overall instructor performance.

This will help the academy maintain teaching quality and identify high-performing instructors.

---

# 4. GENERAL ADMINISTRATOR DASHBOARD

The administrator dashboard should provide a centralized overview of everything happening across Skill Mountain Academy.

Administrators should have access to a comprehensive management interface that allows them to monitor the entire learning ecosystem.

### A. PLATFORM OVERVIEW

Display important platform statistics, including:

- Total registered students.
- Active students.
- Total instructors.
- Active instructors.
- Total programmes.
- Total enrolled courses.
- Completed programmes.
- Ongoing programmes.
- Pending student registrations.

### B. ACADEMIC PERFORMANCE MONITORING

Administrators should be able to monitor:

- Overall student learning progress.
- Assignment completion rates.
- Quiz and assessment performance.
- Course completion rates.
- Student attendance.
- Instructor performance.
- Missed and cancelled sessions.
- Students requiring academic attention.

### C. INSTRUCTOR MANAGEMENT

Administrators should be able to:
- Add and register instructors.
- Edit instructor profiles.
- Assign programmes and courses.
- Assign students to instructors.
- View instructor schedules.
- Monitor attendance and completed sessions.
- Review instructor performance.
- Manage instructor access and permissions.

### D. STUDENT MANAGEMENT

Administrators should be able to:
- Register students.
- Edit student profiles.
- Assign programmes.
- Assign instructors.
- View student learning progress.
- Monitor attendance.
- Review assignment submissions and grades.
- Track student payments.
- Suspend or deactivate accounts when necessary.

### E. FINANCIAL AND PAYMENT MANAGEMENT

The dashboard should provide an overview of academy revenue and student payment records.

It should include:
- Total revenue.
- Payments received.
- Outstanding student balances.
- One-time payments.
- Instalment payments.
- Payment history.
- Failed transactions.
- Student payment status.

### F. WEBSITE AND PLATFORM PERFORMANCE

Administrators should also have access to platform performance indicators, including:
- Website traffic.
- SEO performance and search engine rankings.
- Student registration conversion.
- Platform engagement.
- User activity.
- System performance.
- Error monitoring.
- Security alerts.

The administrator dashboard should function as the central command centre for Skill Mountain Academy.

---

# 5. NOTIFICATIONS AND AUTOMATED REMINDERS

The platform must have a reliable notification system connecting students, instructors, and administrators.

### Student Notifications

Students should receive notifications for:

- Upcoming weekly live sessions.
- Newly assigned meeting links.
- Session reminders.
- New assignments.
- Assignment deadlines.
- New quizzes.
- Graded assessments.
- Instructor messages.
- New learning materials.
- Payment reminders.
- Programme updates.

### Instructor Notifications

Instructors should receive notifications for:

- Upcoming scheduled classes.
- Student messages.
- New student assignments.
- Upcoming assessment deadlines.
- Changes to authorized schedules.
- Administrative announcements.
- Attendance records requiring completion.

### Live Session Reminder Workflow

The platform should automatically send reminders before every scheduled session.

A recommended notification sequence is:

1. **24 hours before:** Notify the student and instructor of the upcoming session.
2. **1 hour before:** Send another reminder with the Google Meet link, provided the instructor has added it.
3. **15 minutes before:** Send a final reminder.
4. **At session time:** Display a prominent Join Live Session button on the student's dashboard.

Notifications should be available through the platform's notification centre and registered email addresses. Additional channels, such as WhatsApp, may be considered as a future integration.

The system must never generate fake meeting links. If the instructor has not added a link, the dashboard should display a clear pending status and notify the instructor.

---

# 6. STUDENT-INSTRUCTOR COMMUNICATION SYSTEM

The platform should have an internal messaging system that allows students to communicate directly with their assigned instructors.

This should function like a simple email inbox within the academy.

### Student Messaging

Students should be able to:
- Send direct messages to their assigned instructors.
- Ask questions about their lessons.
- Request clarification on assignments.
- Seek assistance with practical exercises.
- Receive replies directly in their dashboard inbox.

### Instructor Messaging

Instructors should be able to:
- Receive messages from assigned students.
- Reply directly to students.
- Review previous conversations.
- Send learning instructions and relevant resources.

Students should have an inbox where they can easily identify unread messages and responses from their instructors.

Communication must respect role-based access restrictions. Students should not automatically gain access to other instructors or students' private conversations.

---

# 7. USER EXPERIENCE AND DESIGN DIRECTION

The entire platform should feel like a personal learning environment rather than a conventional school management system.

The student should log in and immediately understand:

- What they are learning.
- What they need to do today.
- What assignments are pending.
- When their next live session is scheduled.
- Whether their instructor has sent a message.
- How far they have progressed.

The interface should be:

- Modern and visually appealing.
- Clean and intuitive.
- Highly responsive across desktop, tablet, and mobile.
- Easy to navigate.
- Professionally structured.
- Fast-loading.
- Accessible to beginners with limited technical experience.

The central learning workspace should receive the highest visual priority.

The interface should avoid unnecessary clutter and should make the student's next learning activity immediately visible.

---

# 8. SECURITY, PERMISSIONS AND BACKEND ARCHITECTURE

The entire system must be built around three separate permission levels:

1. Student.
2. Instructor.
3. Administrator.

All three dashboards should communicate with a centralized backend.

### Role-Based Access Control (RBAC)

The backend must enforce permissions at the server and database levels, not merely hide unauthorized interface elements.

**Student Permissions**
- Access personal profile.
- Access enrolled programmes and approved learning materials.
- View assigned sessions and meeting links.
- Submit assignments and take quizzes.
- View personal grades and progress.
- Communicate with assigned instructors.
- Access their programme-specific AI assistant.

**Instructor Permissions**
- Access assigned programmes and students.
- Manage assigned live session links.
- View their teaching timetable.
- Record attendance.
- Grade assignments and assessments.
- Communicate with assigned students.
- Monitor student progress.

**Administrator Permissions**
- Manage students and instructors.
- Manage programmes and courses.
- Assign instructors and students.
- Monitor academic activities.
- View financial records.
- Manage platform settings.
- Access administrative reports and analytics.

### Security Requirements

The platform must implement:
- Secure authentication.
- Role-based access control.
- Protected API endpoints.
- Secure database access policies.
- Encrypted communication.
- Private student records.
- Secure file uploads.
- Session and access management.
- Audit logs for important administrative activities.

Each user should only access the information and resources authorized for their account.

---

# 9. IMPORTANT SYSTEM DESIGN PRINCIPLES

The following requirements must be treated as core architectural decisions rather than optional interface features.

**1. Separate Recurring Timetables from Individual Sessions**

A student's weekly timetable must remain separate from individual session records. Changing a meeting link, marking attendance, or recording a missed class must never accidentally modify the recurring timetable.

**2. Instructor-Owned Google Meet Links**

Instructors create and manage their own Google Meet links. The platform is responsible for assigning those links to the correct session, notifying the student, and providing secure access.

**3. Protected Session Access**

Students must only access their own assigned meeting links. Instructors must only access their assigned sessions and students.

**4. Mandatory Attendance Tracking**

Instructors must record the outcome of every scheduled session. Administrators must be able to review these records for accountability and reporting.

**5. Programme-Specific AI Assistant**

The AI assistant must use the student's enrolled programme and approved course materials as its learning context. It must not function as an unrestricted, generic chatbot.

**6. Centralized Backend**

All three dashboards must operate from one connected backend with a shared data structure, consistent permissions, and real-time updates where appropriate.

**7. Scalable Architecture**

The platform should be developed in a way that allows Skill Mountain Academy to introduce additional programmes, instructors, students, courses, learning tools, and integrations without rebuilding the entire system.

---

# 10. FINAL DEVELOPMENT OBJECTIVE

The objective is to build Skill Mountain Academy into a complete, personalized digital learning ecosystem.

It should combine:

- A Learning Management System (LMS).
- One-on-one live instructor-led training.
- Google Meet video conferencing.
- Interactive teaching and screen sharing.
- AI-powered academic assistance.
- Assignment and assessment management.
- Student performance tracking.
- Instructor management and accountability.
- Internal messaging.
- Automated notifications and reminders.
- Student registration and payment management.
- Centralized administrative control.

The experience should make every student feel that they have a dedicated learning environment, a personal instructor, and an intelligent learning assistant supporting their development.

**The ultimate goal is simple: when a student logs into Skill Mountain Academy, they should immediately know what to learn, what to do, who to contact, when their next class is, and how far they have progressed.**

This should be built as a secure, reliable, scalable, and professionally engineered educational platform, not merely a collection of dashboard pages.