// seedDemoUsers.js => the people of the presentation data (Phase 4)
//
// node scripts/seedDemoUsers.js             => dry run, only prints what it would do
// node scripts/seedDemoUsers.js --confirm   => really does it (the server must be running: npm run dev)
//
// 1. creates the demo users of demoUsersList.js (they sign up through the real API, two of them become faculty)
// 2. gives the old exam windows their kind (mid semester, end semester, other) and adds a mid semester window for 2 to 6 Nov
// 3. gives some demo users old no-shows, so their reliability scores are different
// 4. adds 4 guardian messages
// Run seedDemoRequests.js after this one. Everything it creates is marked with the demo text in legacyId.
// removeDemoData.js deletes it again.
const mongoose = require("mongoose")
const {connection} = require("../config/db")
const {User} = require("../models/userModel")
const {Resource} = require("../models/resourceModel")
const {Reservation} = require("../models/reservationModel")
const {ExamWindow} = require("../models/examWindowModel")
const {Message} = require("../models/messageModel")
const {callApi, login, checkServer, DEMO_MARK} = require("./demoApi")
const {DEMO_PASSWORD, DEMO_USERS} = require("./demoUsersList")

// the old exam windows get their kind. A window that is not in this list is left as it is
const OLD_WINDOWS = [
    {title: "Mid-Semester Examinations - Odd Semester", kind: "mid_semester_exam"},
    {title: "End-Semester Examinations - Odd Semester", kind: "end_semester_exam"},
    {title: "Backlog / Supplementary Exams", kind: "other"},
    {title: "Practical & Viva Examinations", kind: "other"}
]

// the new window of the presentation: the requests for mid semester exams of 2 to 6 Nov need it
const DEMO_WINDOW = {title: "Mid-Semester Examinations - Even Semester", startDate: "2026-11-02", endDate: "2026-11-06", kind: "mid_semester_exam"}

// the guardian messages (who writes, subject, text)
const MESSAGES = [
    {who: "ananya", subject: "Exam Period Priority Inquiry", message: "Will the Interview Room stay free for placement interviews during the exam week?"},
    {who: "sneha", subject: "Seat Map Question", message: "Can we choose seats next to each other for a group of 4 in the Central Reading Hall?"},
    {who: "arjun", subject: "Guardian Hold Request", message: "Please keep two seats in the Silent Study Hall for my project partners on 30 Oct."},
    {who: "harsh", subject: "Waitlist Question", message: "I am on the waitlist for the Interview Room. How long does it usually take to move up?"}
]

// daysAgo => a date like "2026-10-20" that many days before today (library time)
const daysAgo = (days) => {
    const date = new Date(Date.now() + 330 * 60 * 1000)
    date.setUTCDate(date.getUTCDate() - days)
    return date.toISOString().slice(0, 10)
}

const run = async () => {
    try {
        const confirm = process.argv.includes("--confirm")
        const faculty = DEMO_USERS.filter(user => user.role === "faculty").length
        console.log(DEMO_USERS.length + " demo users (" + faculty + " faculty), " + OLD_WINDOWS.length + " exam windows get a kind, 1 new exam window, " + MESSAGES.length + " messages")
        if (!confirm) {
            console.log("\nDRY RUN: nothing was done. Add --confirm to really do it.")
            return
        }

        await checkServer()
        await connection
        const adminToken = await login("admin@university.edu", "password123")

        // 1. the users
        let created = 0
        for (const demo of DEMO_USERS) {
            if (await User.findOne({email: demo.email})) {
                console.log("Already there: " + demo.email)
                continue
            }
            const result = await callApi("POST", "/auth/signup", null, {
                name: demo.name,
                studentId: demo.studentId,
                email: demo.email,
                password: DEMO_PASSWORD,
                department: demo.department,
                course: demo.course,
                semester: demo.semester
            })
            if (result.status !== 201) {
                console.log("Could not create " + demo.email + ": " + (result.body ? result.body.message : result.status))
                continue
            }
            if (demo.role !== "student") {
                await callApi("PATCH", "/admin/users/" + result.body.user.id, adminToken, {role: demo.role})
            }
            await User.updateOne({_id: result.body.user.id}, {$set: {legacyId: DEMO_MARK}})
            created++
        }
        console.log(created + " user(s) created")

        // 2. the exam windows
        for (const old of OLD_WINDOWS) {
            const result = await ExamWindow.updateOne({title: old.title}, {$set: {kind: old.kind}})
            console.log("Exam window " + old.title + ": " + (result.matchedCount > 0 ? "kind set to " + old.kind : "not found"))
        }
        if (await ExamWindow.findOne({title: DEMO_WINDOW.title, startDate: DEMO_WINDOW.startDate})) {
            console.log("The demo exam window is already there")
        } else {
            const result = await callApi("POST", "/exam-windows", adminToken, DEMO_WINDOW)
            if (result.status === 201) {
                await ExamWindow.updateOne({_id: result.body.data.id}, {$set: {legacyId: DEMO_MARK}})
                console.log("Exam window added: " + DEMO_WINDOW.title)
            } else {
                console.log("Could not add the exam window: " + (result.body ? result.body.message : result.status))
            }
        }

        // 3. old no-shows (in the last 90 days) change the reliability score of a user
        const room = await Resource.findOne()
        let strikes = 0
        for (const demo of DEMO_USERS) {
            const user = await User.findOne({email: demo.email})
            if (!user || !demo.strikes || await Reservation.findOne({user: user._id, status: "no_show", legacyId: DEMO_MARK})) {
                continue
            }
            for (let i = 0; i < demo.strikes; i++) {
                await Reservation.create({
                    user: user._id,
                    resource: room._id,
                    date: daysAgo(4 + i * 9),
                    startTime: "10:00",
                    endTime: "12:00",
                    status: "no_show",
                    purpose: "general_study",
                    groupSize: 1,
                    reason: "Marked as no-show",
                    legacyId: DEMO_MARK
                })
                strikes++
            }
            await User.updateOne({_id: user._id}, {$set: {noShowCount: demo.strikes}})
        }
        console.log(strikes + " old no-show(s) added")

        // 4. the messages
        let written = 0
        for (const item of MESSAGES) {
            const demo = DEMO_USERS.find(user => user.key === item.who)
            if (await Message.findOne({email: demo.email, subject: item.subject})) {
                continue
            }
            const token = await login(demo.email, DEMO_PASSWORD)
            const result = await callApi("POST", "/messages", token, {subject: item.subject, message: item.message})
            if (result.status === 201) {
                await Message.updateOne({_id: result.body.data.id}, {$set: {legacyId: DEMO_MARK}})
                written++
            }
        }
        console.log(written + " message(s) written")
        console.log("\nDone. Now run seedDemoRequests.js")
    } catch (error) {
        console.log("Seeding the demo users failed: " + error.message)
    } finally {
        await mongoose.connection.close()
    }
}

run()
