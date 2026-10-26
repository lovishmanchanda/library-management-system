// seedDemoRequests.js => the presentation requests (Phase 4): about 100 requests from 26 Oct to 8 Nov 2026
//
// node scripts/seedDemoRequests.js             => dry run, only counts what it would do
// node scripts/seedDemoRequests.js --confirm   => really does it (the server must be running: npm run dev)
//
// Run seedRooms.js and seedDemoUsers.js first. The script books like real users do (it logs in as each person and
// calls the real API), and it asks the admin to run the allocation for the days that are already allocated.
// So every status you see (confirmed with seats, unallocated, offers, waitlist, cancelled, no-show) comes from the real rules.
//   26 Oct to 3 Nov: the allocation is run. Two days have a crowded Interview Room (offers, waitlist, an automatic promotion)
//   4 Nov to 8 Nov : only pending requests, so you can press "Run allocation" yourself in the presentation
// Everything it creates is marked with the demo text in legacyId. removeDemoData.js deletes it again.
const mongoose = require("mongoose")
const {connection} = require("../config/db")
const {Reservation} = require("../models/reservationModel")
const {callApi, login, checkServer, DEMO_MARK} = require("./demoApi")
const {DEMO_PASSWORD, emailOf} = require("./demoUsersList")

const FIRST_DAY = "2026-10-26" // a Monday. Day 0 is this date, day 1 the next one ...
const LAST_ALLOCATED_DAY = 8   // days 0 to 8 (26 Oct to 3 Nov) get an allocation run, days 9 to 13 stay pending

// the short names of the rooms used in the table below
const ROOMS = {
    CRH: "Central Reading Hall",
    SSH: "Silent Study Hall",
    DL: "Digital Lab",
    SH: "Seminar Hall",
    CH: "Collaboration Hall",
    IR: "Interview Room",
    E2: "Media Projector Room E2",
    N2: "Community Study Hall N2",
    E1: "Media Projector Room E1"
}

// the requests. who = the person who books, members = the other people of the group, seats = the seats they wish for.
// tag = a name so the story code below can find the request again.
// after = the request is made AFTER the allocation run of its day (so it is allocated at once)
// cancel = the student cancels it after the run, noShow = the admin marks it as no-show if it has already started
const REQUESTS = [
    {day: 0, room: "DL", start: "08:00", end: "10:00", who: "tanvi", purpose: "project_work", seats: ["C4"], noShow: true},
    {day: 0, room: "SSH", start: "08:00", end: "10:00", who: "yash", purpose: "general_study", seats: ["B2"], after: true, noShow: true},
    {day: 0, room: "CRH", start: "11:00", end: "13:00", who: "sneha", purpose: "general_study", seats: ["D8"]},
    {day: 0, room: "DL", start: "11:00", end: "13:00", who: "rohan", purpose: "project_work"},
    {day: 0, room: "SH", start: "11:00", end: "13:00", who: "aarav", purpose: "quarterly_test", members: ["vikram", "diya", "meera"], seats: ["A1", "A2", "A3", "A4"]},
    {day: 0, room: "SSH", start: "11:00", end: "13:00", who: "pooja", purpose: "general_study"},
    {day: 0, room: "SSH", start: "14:00", end: "16:00", who: "yash", purpose: "general_study"},
    {day: 0, room: "CH", start: "15:00", end: "17:00", who: "pooja", purpose: "project_work", seats: ["E3"]},
    {day: 0, room: "N2", start: "15:00", end: "17:00", who: "tanvi", purpose: "general_study", seats: ["A2"]},
    {day: 0, room: "N2", start: "17:00", end: "19:00", who: "manav", purpose: "project_work", members: ["aarav", "rahul", "neha"], seats: ["B1", "B2", "B3", "B4"]},
    {day: 1, room: "E2", start: "08:00", end: "10:00", who: "neha", purpose: "project_work"},
    {day: 1, room: "SSH", start: "09:30", end: "11:30", who: "priya", purpose: "general_study"},
    {day: 1, room: "IR", start: "10:00", end: "12:00", who: "arjun", purpose: "job_interview", seats: ["A1"], tag: "A-arjun"},
    {day: 1, room: "IR", start: "10:00", end: "12:00", who: "ananya", purpose: "job_interview", members: ["manav"], tag: "A-ananya"},
    {day: 1, room: "IR", start: "10:00", end: "12:00", who: "sneha", purpose: "job_interview", tag: "A-sneha"},
    {day: 1, room: "IR", start: "10:00", end: "12:00", who: "harsh", purpose: "job_interview", members: ["kabir"], tag: "A-harsh"},
    {day: 1, room: "IR", start: "10:00", end: "12:00", who: "pooja", purpose: "job_interview", members: ["rahul", "diya"], tag: "A-pooja"},
    {day: 1, room: "IR", start: "10:00", end: "12:00", who: "meera", purpose: "job_interview", tag: "A-meera"},
    {day: 1, room: "CRH", start: "12:00", end: "14:00", who: "manav", purpose: "general_study", seats: ["D6"]},
    {day: 1, room: "CRH", start: "15:00", end: "17:00", who: "manav", purpose: "general_study", seats: ["E1"]},
    {day: 1, room: "E1", start: "16:00", end: "18:00", who: "sunita", purpose: "general_study", seats: ["B4"]},
    {day: 1, room: "CRH", start: "17:00", end: "19:00", who: "vikram", purpose: "general_study", members: ["pooja"]},
    {day: 2, room: "SH", start: "08:00", end: "10:00", who: "rahul", purpose: "quarterly_test", members: ["diya"], seats: ["B6", "B7"], cancel: true},
    {day: 2, room: "E2", start: "10:00", end: "12:00", who: "anil", purpose: "general_study"},
    {day: 2, room: "DL", start: "12:00", end: "14:00", who: "pooja", purpose: "project_work"},
    {day: 2, room: "SSH", start: "12:00", end: "14:00", who: "aarav", purpose: "general_study"},
    {day: 2, room: "CRH", start: "14:00", end: "16:00", who: "ishita", purpose: "project_work"},
    {day: 2, room: "CH", start: "15:00", end: "17:00", who: "yash", purpose: "quarterly_test", members: ["tanvi"]},
    {day: 2, room: "CRH", start: "16:00", end: "18:00", who: "kabir", purpose: "general_study", members: ["harsh"], seats: ["D7", "D8"]},
    {day: 2, room: "SSH", start: "16:00", end: "18:00", who: "sunita", purpose: "general_study", seats: ["B2"], after: true},
    {day: 3, room: "CRH", start: "08:00", end: "10:00", who: "neha", purpose: "general_study"},
    {day: 3, room: "SH", start: "08:00", end: "10:00", who: "rahul", purpose: "quarterly_test", members: ["ananya"], seats: ["E1", "E2"], cancel: true},
    {day: 3, room: "SH", start: "09:30", end: "11:30", who: "aarav", purpose: "quarterly_test", members: ["priya"]},
    {day: 3, room: "CRH", start: "13:30", end: "15:30", who: "harsh", purpose: "project_work", seats: ["A7"], cancel: true},
    {day: 3, room: "E2", start: "14:00", end: "16:00", who: "rahul", purpose: "project_work", members: ["meera", "kabir"]},
    {day: 3, room: "SH", start: "15:00", end: "17:00", who: "priya", purpose: "quarterly_test"},
    {day: 3, room: "SSH", start: "16:00", end: "18:00", who: "yash", purpose: "general_study", after: true},
    {day: 3, room: "SH", start: "17:00", end: "19:00", who: "ishita", purpose: "quarterly_test", seats: ["E4"], cancel: true},
    {day: 4, room: "DL", start: "10:00", end: "12:00", who: "manav", purpose: "project_work", seats: ["D8"]},
    {day: 4, room: "SH", start: "11:00", end: "13:00", who: "meera", purpose: "quarterly_test", members: ["arjun", "sneha"], seats: ["B5", "B6", "B7"]},
    {day: 4, room: "SSH", start: "12:00", end: "14:00", who: "tanvi", purpose: "general_study", members: ["diya"], seats: ["E1", "E2"]},
    {day: 4, room: "E2", start: "15:00", end: "17:00", who: "priya", purpose: "project_work", seats: ["B1"]},
    {day: 4, room: "SH", start: "15:00", end: "17:00", who: "sneha", purpose: "quarterly_test", members: ["arjun", "pooja", "diya", "ishita"]},
    {day: 4, room: "DL", start: "16:00", end: "18:00", who: "manav", purpose: "project_work", seats: ["E8"]},
    {day: 4, room: "E2", start: "16:00", end: "18:00", who: "kabir", purpose: "project_work", members: ["harsh"]},
    {day: 4, room: "N2", start: "17:00", end: "19:00", who: "aarav", purpose: "quarterly_test", members: ["rahul", "ishita", "neha"]},
    {day: 5, room: "E1", start: "09:30", end: "11:30", who: "pooja", purpose: "project_work", members: ["kabir", "meera", "vikram"]},
    {day: 5, room: "CRH", start: "10:00", end: "12:00", who: "ishita", purpose: "general_study", seats: ["D1"]},
    {day: 5, room: "CH", start: "12:00", end: "14:00", who: "priya", purpose: "general_study", members: ["ananya", "vikram"], seats: ["E4", "E5", "E6"]},
    {day: 5, room: "E1", start: "12:00", end: "14:00", who: "neha", purpose: "project_work", members: ["aarav", "yash", "meera", "harsh"]},
    {day: 5, room: "IR", start: "14:00", end: "16:00", who: "arjun", purpose: "job_interview", tag: "B-arjun"},
    {day: 5, room: "IR", start: "14:00", end: "16:00", who: "pooja", purpose: "job_interview", members: ["rahul", "diya"], tag: "B-pooja"},
    {day: 5, room: "IR", start: "14:00", end: "16:00", who: "ananya", purpose: "job_interview", members: ["manav"], tag: "B-ananya"},
    {day: 5, room: "IR", start: "14:00", end: "16:00", who: "sneha", purpose: "job_interview", tag: "B-sneha"},
    {day: 5, room: "IR", start: "14:00", end: "16:00", who: "harsh", purpose: "job_interview", members: ["kabir"], tag: "B-harsh"},
    {day: 5, room: "IR", start: "14:00", end: "16:00", who: "meera", purpose: "job_interview", tag: "B-meera"},
    {day: 6, room: "E1", start: "08:00", end: "10:00", who: "manav", purpose: "project_work", members: ["tanvi", "meera"], seats: ["A1", "A2", "A3"]},
    {day: 6, room: "SSH", start: "10:00", end: "12:00", who: "diya", purpose: "general_study", after: true},
    {day: 6, room: "DL", start: "17:00", end: "19:00", who: "meera", purpose: "project_work", members: ["arjun"]},
    {day: 7, room: "CRH", start: "09:30", end: "11:30", who: "harsh", purpose: "mid_semester_exam", seats: ["A5"]},
    {day: 7, room: "DL", start: "09:30", end: "11:30", who: "anil", purpose: "general_study", seats: ["D7"]},
    {day: 7, room: "CRH", start: "10:00", end: "12:00", who: "yash", purpose: "general_study", seats: ["D1"]},
    {day: 7, room: "CRH", start: "10:00", end: "12:00", who: "diya", purpose: "mid_semester_exam", members: ["kabir"]},
    {day: 7, room: "SH", start: "10:00", end: "12:00", who: "sunita", purpose: "general_study", seats: ["E1"], after: true},
    {day: 7, room: "CRH", start: "12:00", end: "14:00", who: "aarav", purpose: "mid_semester_exam"},
    {day: 7, room: "SSH", start: "13:30", end: "15:30", who: "priya", purpose: "mid_semester_exam", members: ["rahul"], seats: ["D1", "D2"]},
    {day: 7, room: "SSH", start: "13:30", end: "15:30", who: "kabir", purpose: "mid_semester_exam", seats: ["D1"]},
    {day: 7, room: "CRH", start: "14:00", end: "16:00", who: "manav", purpose: "mid_semester_exam", seats: ["A1"]},
    {day: 7, room: "DL", start: "16:00", end: "18:00", who: "ishita", purpose: "mid_semester_exam"},
    {day: 8, room: "CRH", start: "10:00", end: "12:00", who: "neha", purpose: "mid_semester_exam", seats: ["A3"]},
    {day: 8, room: "SSH", start: "10:00", end: "12:00", who: "sneha", purpose: "general_study"},
    {day: 8, room: "CRH", start: "12:00", end: "14:00", who: "meera", purpose: "mid_semester_exam", members: ["sneha"], seats: ["F3", "F4"]},
    {day: 8, room: "SSH", start: "12:00", end: "14:00", who: "kabir", purpose: "general_study", seats: ["A4"]},
    {day: 8, room: "CRH", start: "14:00", end: "16:00", who: "manav", purpose: "mid_semester_exam", members: ["pooja"]},
    {day: 8, room: "SSH", start: "14:00", end: "16:00", who: "ananya", purpose: "general_study", seats: ["C3"], after: true},
    {day: 8, room: "SSH", start: "14:00", end: "16:00", who: "rohan", purpose: "general_study", seats: ["D4"]},
    {day: 8, room: "CRH", start: "17:00", end: "19:00", who: "pooja", purpose: "general_study", seats: ["A1"]},
    {day: 9, room: "CRH", start: "09:30", end: "11:30", who: "sneha", purpose: "mid_semester_exam", seats: ["D1"]},
    {day: 9, room: "SH", start: "10:00", end: "12:00", who: "ananya", purpose: "quarterly_test", members: ["vikram", "tanvi", "rahul", "ishita"]},
    {day: 9, room: "CRH", start: "11:00", end: "13:00", who: "kabir", purpose: "general_study", members: ["yash", "rohan"]},
    {day: 9, room: "CRH", start: "13:30", end: "15:30", who: "neha", purpose: "mid_semester_exam", members: ["arjun"], seats: ["A7", "A8"]},
    {day: 9, room: "SH", start: "15:00", end: "17:00", who: "rahul", purpose: "quarterly_test", seats: ["B10"]},
    {day: 9, room: "SSH", start: "16:00", end: "18:00", who: "vikram", purpose: "general_study", seats: ["D2"]},
    {day: 9, room: "SSH", start: "16:00", end: "18:00", who: "arjun", purpose: "mid_semester_exam", members: ["neha", "ishita"], seats: ["B5", "B6", "B7"]},
    {day: 10, room: "SSH", start: "08:00", end: "10:00", who: "sunita", purpose: "general_study"},
    {day: 10, room: "SH", start: "10:00", end: "12:00", who: "arjun", purpose: "quarterly_test", members: ["ishita"], seats: ["C2", "C3"]},
    {day: 10, room: "SSH", start: "10:00", end: "12:00", who: "anil", purpose: "general_study", seats: ["C1"]},
    {day: 10, room: "SSH", start: "12:00", end: "14:00", who: "anil", purpose: "general_study", seats: ["E8"]},
    {day: 10, room: "CRH", start: "13:30", end: "15:30", who: "arjun", purpose: "mid_semester_exam", members: ["priya", "manav", "sneha"], seats: ["F3", "F4", "F5", "F6"]},
    {day: 10, room: "SSH", start: "14:00", end: "16:00", who: "sunita", purpose: "general_study", seats: ["E5"]},
    {day: 10, room: "SSH", start: "17:00", end: "19:00", who: "priya", purpose: "mid_semester_exam", members: ["ishita"], seats: ["A6", "A7"]},
    {day: 11, room: "CRH", start: "10:00", end: "12:00", who: "manav", purpose: "general_study", seats: ["A9"]},
    {day: 11, room: "SH", start: "11:00", end: "13:00", who: "arjun", purpose: "quarterly_test", members: ["kabir"]},
    {day: 11, room: "SSH", start: "11:00", end: "13:00", who: "sunita", purpose: "general_study"},
    {day: 11, room: "SSH", start: "11:00", end: "13:00", who: "tanvi", purpose: "mid_semester_exam", members: ["rohan", "sneha"], seats: ["B6", "B7", "B8"]},
    {day: 11, room: "SSH", start: "11:00", end: "13:00", who: "meera", purpose: "mid_semester_exam", members: ["harsh"]},
    {day: 11, room: "CH", start: "17:00", end: "19:00", who: "anil", purpose: "general_study", seats: ["C3"]},
    {day: 11, room: "SSH", start: "17:00", end: "19:00", who: "arjun", purpose: "mid_semester_exam", members: ["manav", "tanvi"]},
    {day: 12, room: "N2", start: "10:00", end: "12:00", who: "anil", purpose: "general_study"},
    {day: 12, room: "SH", start: "10:00", end: "12:00", who: "yash", purpose: "quarterly_test", members: ["ishita", "priya", "kabir", "meera"]},
    {day: 12, room: "SH", start: "11:00", end: "13:00", who: "manav", purpose: "quarterly_test", members: ["pooja", "aarav", "rohan"]},
    {day: 12, room: "CRH", start: "15:00", end: "17:00", who: "meera", purpose: "general_study", seats: ["B1"]},
    {day: 12, room: "CH", start: "17:00", end: "19:00", who: "manav", purpose: "quarterly_test", members: ["diya"], seats: ["C1", "C2"]},
    {day: 12, room: "SH", start: "17:00", end: "19:00", who: "harsh", purpose: "quarterly_test", members: ["vikram", "ishita", "arjun", "kabir"], seats: ["B6", "B7", "B8", "B9", "B10"]},
    {day: 13, room: "DL", start: "09:30", end: "11:30", who: "pooja", purpose: "project_work"},
    {day: 13, room: "DL", start: "11:00", end: "13:00", who: "ananya", purpose: "general_study", seats: ["B7"]},
    {day: 13, room: "CRH", start: "12:00", end: "14:00", who: "vikram", purpose: "general_study", members: ["kabir", "neha", "rahul"], seats: ["C7", "C8", "C9", "C10"]},
    {day: 13, room: "SSH", start: "14:00", end: "16:00", who: "diya", purpose: "general_study", members: ["vikram", "ananya"]},
    {day: 13, room: "SH", start: "16:00", end: "18:00", who: "arjun", purpose: "quarterly_test", members: ["rahul", "harsh"], seats: ["B1", "B2", "B3"]},
]

// ---- small helpers ----

// the date of a day number: day 0 is 2026-10-26
const dateOf = (day) => {
    const date = new Date(FIRST_DAY + "T00:00:00Z")
    date.setUTCDate(date.getUTCDate() + day)
    return date.toISOString().slice(0, 10)
}

// the library time right now (India, UTC+5:30) as text like "2026-10-26T14:30:00.000Z"
const libraryNow = () => {
    return new Date(Date.now() + 330 * 60 * 1000).toISOString()
}

// true if a booking has already started
const hasStarted = (date, startTime) => {
    const now = libraryNow()
    if (date < now.slice(0, 10)) {
        return true
    }
    return date === now.slice(0, 10) && startTime <= now.slice(11, 16)
}

let rooms = {}      // short room name -> room id, filled when the script starts
const tokens = {}   // the token of every person we logged in as
const ids = {}      // tag -> reservation id
const created = []  // the ids of all requests that were made
let problems = 0

// tokenOf => logs in as a person once and remembers the token
const tokenOf = async (key) => {
    if (!tokens[key]) {
        tokens[key] = await login(emailOf(key), DEMO_PASSWORD)
    }
    return tokens[key]
}

// say => prints a line, and counts the problems
const say = (text, isProblem) => {
    if (isProblem) {
        problems++
    }
    console.log((isProblem ? "   !! " : "   ") + text)
}

// ask => one request through the API. The id is kept in row.id, and given back (or null if the server said no)
const ask = async (row) => {
    if (dateOf(row.day) < libraryNow().slice(0, 10)) {
        return null // the day has already passed, the server does not take requests for the past
    }
    const body = {
        resourceId: rooms[row.room],
        date: dateOf(row.day),
        startTime: row.start,
        endTime: row.end,
        purpose: row.purpose
    }
    if (row.purpose !== "general_study") {
        body.eventDate = dateOf(row.day)
    }
    if (row.members) {
        body.memberEmails = row.members.map(emailOf)
    }
    if (row.seats) {
        body.preferredSeats = row.seats
    }
    const result = await callApi("POST", "/reservations", await tokenOf(row.who), body)
    if (result.status !== 201) {
        say(row.who + " " + ROOMS[row.room] + " " + body.date + " " + row.start + ": " + (result.body ? result.body.message : result.status), true)
        return null
    }
    created.push(result.body.data.id)
    row.id = result.body.data.id
    if (row.tag) {
        ids[row.tag] = result.body.data.id
    }
    return row.id
}

// answer => one call as a person (accept, reject, waitlist, cancel). Prints a problem if the server said no
const answer = async (who, method, path, text) => {
    const result = await callApi(method, path, await tokenOf(who))
    if (result.status !== 200) {
        say(text + " did not work: " + (result.body ? result.body.message : result.status), true)
        return false
    }
    return true
}

// ---- the stories of the crowded days ----

// statusOf => the status of a request by its tag. The stories only work on requests that really have no room left
const statusOf = async (tag) => {
    const reservation = await Reservation.findById(ids[tag])
    return reservation ? reservation.status : "missing"
}

// 27 Oct: the Interview Room has 6 seats and 8 people want it. Two requests have no room left.
// Pooja's group accepts the offer for the Collaboration Hall. Meera rejects the offer and joins the waitlist.
// Then Arjun cancels his seat and Meera is confirmed from the waitlist.
const afterRunDay1 = async () => {
    console.log("   story: offers and the waitlist in the Interview Room")
    if (await statusOf("A-pooja") === "unallocated") {
        await answer("pooja", "POST", "/reservations/" + ids["A-pooja"] + "/offer/accept", "Pooja accepting the offer")
    }
    if (await statusOf("A-meera") === "unallocated") {
        await answer("meera", "POST", "/reservations/" + ids["A-meera"] + "/offer/reject", "Meera rejecting the offer")
        await answer("meera", "POST", "/reservations/" + ids["A-meera"] + "/waitlist", "Meera joining the waitlist")
    }
    await answer("arjun", "DELETE", "/reservations/" + ids["A-arjun"], "Arjun cancelling")
}

// 31 Oct: the Interview Room is full again. Pooja's group keeps an open offer. Meera rejects hers and waits in the queue.
const afterRunDay5 = async () => {
    console.log("   story: one open offer and a waitlisted request")
    if (await statusOf("B-meera") === "unallocated") {
        await answer("meera", "POST", "/reservations/" + ids["B-meera"] + "/offer/reject", "Meera rejecting the offer")
        await answer("meera", "POST", "/reservations/" + ids["B-meera"] + "/waitlist", "Meera joining the waitlist")
    }
}

const run = async () => {
    try {
        const confirm = process.argv.includes("--confirm")
        const perDay = {}
        for (const row of REQUESTS) {
            perDay[row.day] = (perDay[row.day] || 0) + 1
        }
        console.log(REQUESTS.length + " requests from " + dateOf(0) + " to " + dateOf(13))
        for (const day of Object.keys(perDay)) {
            console.log("  " + dateOf(Number(day)) + ": " + perDay[day] + " request(s)" + (Number(day) <= LAST_ALLOCATED_DAY ? ", allocation is run" : ", stays pending"))
        }
        if (!confirm) {
            console.log("\nDRY RUN: nothing was done. Add --confirm to really do it.")
            return
        }

        await checkServer()
        await connection
        // (the old no-shows of seedDemoUsers.js are also demo data, but they are dated before the first demo day)
        if (await Reservation.countDocuments({legacyId: DEMO_MARK, date: {$gte: FIRST_DAY}}) > 0) {
            console.log("\nThe demo requests are already there. Run removeDemoData.js --confirm first if you want them again.")
            return
        }

        // the rooms by name
        const adminToken = await login("admin@university.edu", "password123")
        const list = await callApi("GET", "/resources", adminToken)
        for (const short of Object.keys(ROOMS)) {
            const room = list.body.data.find(item => item.label === ROOMS[short])
            if (room) {
                rooms[short] = room.id
            } else {
                console.log("Room not found: " + ROOMS[short] + " (run seedRooms.js first). Its requests are skipped.")
            }
        }

        for (let day = 0; day <= 13; day++) {
            console.log("\n" + dateOf(day))
            const today = REQUESTS.filter(row => row.day === day && rooms[row.room])

            // 1. the requests of the day. They wait as pending
            for (const row of today.filter(item => !item.after)) {
                await ask(row)
            }

            // 2. the admin runs the allocation for the days that are already allocated
            if (day <= LAST_ALLOCATED_DAY) {
                const result = await callApi("POST", "/admin/allocate", adminToken, {date: dateOf(day)})
                if (result.status === 200) {
                    const summary = result.body.data.run
                    say("allocation: " + summary.confirmed + " confirmed, " + summary.unallocated + " unallocated, " + summary.offers + " offer(s)")
                } else {
                    say("the allocation did not work: " + (result.body ? result.body.message : result.status), true)
                }
            }

            // 3. what the students do after the run
            if (day === 1) {
                await afterRunDay1()
            }
            if (day === 5) {
                await afterRunDay5()
            }
            // requests that are made after the run are allocated at once
            for (const row of today.filter(item => item.after)) {
                await ask(row)
            }
            // students who change their mind and cancel
            for (const row of today.filter(item => item.cancel && item.id)) {
                await answer(row.who, "DELETE", "/reservations/" + row.id, row.who + " cancelling")
            }
        }

        // the admin marks the early requests of today as no-show, but only if their time has really started
        for (const row of REQUESTS.filter(item => item.noShow && item.id)) {
            if (hasStarted(dateOf(row.day), row.start)) {
                const result = await callApi("POST", "/admin/reservations/" + row.id + "/no-show", adminToken)
                say(row.who + " marked as no-show: " + (result.status === 200 ? "yes" : "no (" + (result.body ? result.body.message : result.status) + ")"), result.status !== 200)
            } else {
                say(row.who + " has not started yet, so no no-show mark")
            }
        }

        // 4. mark everything as demo data
        const marked = await Reservation.updateMany({_id: {$in: created}}, {$set: {legacyId: DEMO_MARK}})
        console.log("\n" + created.length + " requests were made, " + marked.modifiedCount + " marked as demo data, " + problems + " problem(s).")
    } catch (error) {
        console.log("Seeding the demo requests failed: " + error.message)
    } finally {
        await mongoose.connection.close()
    }
}

run()
