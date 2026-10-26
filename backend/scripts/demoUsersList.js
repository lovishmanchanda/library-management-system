// demoUsersList.js => the people of the presentation data (Phase 4).
// seedDemoUsers.js creates the DEMO_USERS and seedDemoRequests.js lets all of them (and four users that were
// already there) book rooms. Every demo user has the same password so you can log in as anybody.

const DEMO_PASSWORD = "password123"

// strikes = how many old no-shows the user gets in the last 90 days (this changes the reliability score)
const DEMO_USERS = [
    {key: "ananya", name: "Ananya Reddy", email: "ananya.reddy@university.edu", role: "student", course: "B.Tech", department: "Computer Science", semester: 7, studentId: "2210994101", strikes: 0},
    {key: "vikram", name: "Vikram Chauhan", email: "vikram.chauhan@university.edu", role: "student", course: "B.Tech", department: "Electronics Engineering", semester: 5, studentId: "2310994102", strikes: 1},
    {key: "ishita", name: "Ishita Gupta", email: "ishita.gupta@university.edu", role: "student", course: "MSc", department: "Physics", semester: 3, studentId: "2410994103", strikes: 0},
    {key: "manav", name: "Manav Kapoor", email: "manav.kapoor@university.edu", role: "student", course: "B.Tech", department: "Mechanical Engineering", semester: 3, studentId: "2410994104", strikes: 2},
    {key: "sneha", name: "Sneha Iyer", email: "sneha.iyer@university.edu", role: "student", course: "BBA", department: "Management", semester: 5, studentId: "2310994105", strikes: 0},
    {key: "arjun", name: "Arjun Mehta", email: "arjun.mehta@university.edu", role: "student", course: "B.Tech", department: "Civil Engineering", semester: 8, studentId: "2210994106", strikes: 0},
    {key: "pooja", name: "Pooja Bansal", email: "pooja.bansal@university.edu", role: "student", course: "M.Tech", department: "Computer Science", semester: 2, studentId: "2410994107", strikes: 1},
    {key: "rahul", name: "Rahul Yadav", email: "rahul.yadav@university.edu", role: "student", course: "B.Tech", department: "Electrical Engineering", semester: 1, studentId: "2510994108", strikes: 0},
    {key: "diya", name: "Diya Patel", email: "diya.patel@university.edu", role: "student", course: "BSc", department: "Biotechnology", semester: 4, studentId: "2410994109", strikes: 0},
    {key: "harsh", name: "Harsh Vardhan", email: "harsh.vardhan@university.edu", role: "student", course: "MBA", department: "Management", semester: 3, studentId: "2410994110", strikes: 0},
    {key: "meera", name: "Meera Krishnan", email: "meera.krishnan@university.edu", role: "student", course: "PhD", department: "Computer Science", semester: 5, studentId: "2310994111", strikes: 0},
    {key: "kabir", name: "Kabir Sethi", email: "kabir.sethi@university.edu", role: "student", course: "B.Tech", department: "Computer Science", semester: 2, studentId: "2510994112", strikes: 2},
    {key: "tanvi", name: "Tanvi Deshmukh", email: "tanvi.deshmukh@university.edu", role: "student", course: "BSc", department: "Mathematics", semester: 6, studentId: "2210994113", strikes: 1},
    {key: "yash", name: "Yash Agarwal", email: "yash.agarwal@university.edu", role: "student", course: "B.Tech", department: "Electronics Engineering", semester: 7, studentId: "2210994114", strikes: 0},
    {key: "sunita", name: "Dr. Sunita Rao", email: "sunita.rao@university.edu", role: "faculty", department: "Computer Science", studentId: "FAC-2101", strikes: 0},
    {key: "anil", name: "Prof. Anil Kulkarni", email: "anil.kulkarni@university.edu", role: "faculty", department: "Mechanical Engineering", studentId: "FAC-2102", strikes: 0}
]

// four users that are already in the database (from the first migration). They take part in the demo too
const EXISTING_USERS = {
    aarav: "aarav.sharma@university.edu",
    priya: "priya.nair@university.edu",
    rohan: "rohan.verma@university.edu",
    neha: "neha.joshi@university.edu"
}

// emailOf => the email of a person from the short name used in the demo tables, for example "ananya"
const emailOf = (key) => {
    if (EXISTING_USERS[key]) {
        return EXISTING_USERS[key]
    }
    const user = DEMO_USERS.find(item => item.key === key)
    return user ? user.email : null
}

module.exports = {DEMO_PASSWORD, DEMO_USERS, EXISTING_USERS, emailOf}
