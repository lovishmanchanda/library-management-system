# Atlas Room API Reference

The REST API of Atlas Room. Every path starts with `/api`.

- Local: `http://localhost:3000/api`
- Live demo: `https://atlas-room.onrender.com/api`

## Contents
- [Conventions](#conventions)
- [Accounts and users](#accounts-and-users)
- [Resources and seat maps](#resources-and-seat-maps)
- [Reservations](#reservations)
- [Alternative offers and the waitlist](#alternative-offers-and-the-waitlist)
- [Recommendations](#recommendations)
- [Admin: reservations](#admin-reservations)
- [Admin: allocation](#admin-allocation)
- [Exam windows](#exam-windows)
- [Messages](#messages)
- [Health](#health)
- [Reference: values and rules](#reference-values-and-rules)

## Conventions

**Authentication.** Log in (or sign up) to get a JWT. Send it on every protected request:

```
Authorization: Bearer <token>
```

The token is valid for one day. Its payload holds only the user id and role. A suspension is checked in the database on every booking, not in the token.

**Access levels used below**

| Level | Meaning |
|---|---|
| public | no token needed |
| auth | any logged-in user |
| admin | logged in with the role `admin` |
| requester | the user who made the booking |

**Responses**

```json
{ "message": "Resources fetched successfully", "data": [ ... ] }
```

Sign up and log in answer `{ "message", "token", "user" }`. Errors answer `{ "message": "..." }`. Passwords never appear in a response.

**Status codes**

| Code | Meaning |
|---|---|
| 200 | OK |
| 201 | created |
| 400 | invalid input |
| 401 | missing, invalid or expired token (or wrong email or password at login) |
| 403 | the role is not allowed, or the account is suspended |
| 404 | not found |
| 409 | conflict (duplicate email, the room is full, overlapping booking) |
| 500 | unexpected server error |

**Formats.** Dates are `"YYYY-MM-DD"`, times are `"HH:MM"` on the hour or half hour (`"10:00"`, `"10:30"`). "Today" and "has the booking started" use library time, set by `LIBRARY_UTC_OFFSET_MINUTES` (default 330, UTC+5:30). Ids are MongoDB ids (24 hex characters) and are returned as `id`.

---

## Accounts and users

| Method and path | Access | Purpose |
|---|---|---|
| POST `/auth/signup` | public | create a student account |
| POST `/auth/login` | public | log in |
| GET `/auth/me` | auth | the logged-in user with priority numbers |
| PATCH `/users/me` | auth | edit own profile |
| GET `/admin/users` | admin | list all users |
| PATCH `/admin/users/:id` | admin | change a user's role |
| POST `/admin/users/:id/suspend` | admin | suspend a user |
| POST `/admin/users/:id/unsuspend` | admin | lift a suspension |

### POST `/auth/signup`
Body: `name`, `email`, `password` (required, at least 8 characters, email must contain `@`); optional `studentId`, `department`, `course`, `semester` (a number, 1 or more). The role is always `student`; a role in the body is ignored.
Answers `201` with `token` and `user`. `409` if the email is already registered.

### POST `/auth/login`
Body: `{ "email", "password" }`. Answers `200` with `token` and `user`. `401` for a wrong email or password.

### GET `/auth/me`
Answers the user and `priority`: `{ roleScore, reliabilityScore, recentNoShows }` (see [priority score](#priority-score)).

### PATCH `/users/me`
Body: any of `name` (not empty), `department`, `course`, `semester`. Nothing else can be changed (`400 "Nothing to update"`).

### GET `/admin/users`
Every user with `priority`.

### PATCH `/admin/users/:id`
Body: `{ "role": "student" | "faculty" | "librarian" | "admin" }`. An admin cannot change their own role.

### POST `/admin/users/:id/suspend`
Body: `{ "days": 1 | 7 | 30 | null, "reason": "text" }`. `null` suspends without an end date. An admin cannot suspend themselves. A suspended user cannot create bookings (`403`).

### POST `/admin/users/:id/unsuspend`
Clears the suspension.

---

## Resources and seat maps

A resource is a bookable room. A room can have a seat map (see [seat maps](#seat-maps)).

| Method and path | Access | Purpose |
|---|---|---|
| GET `/resources` | auth | list resources |
| GET `/resources/:id` | auth | one resource |
| GET `/resources/:id/availability` | auth | free seats at a time |
| GET `/resources/:id/seats` | auth | seat map with the taken seats at a time |
| POST `/resources` | admin | create a resource |
| PATCH `/resources/:id` | admin | edit a resource |
| DELETE `/resources/:id` | admin | delete a resource |

### GET `/resources`
Optional query `type` and `zone`. Students see active resources only, admins see all. Each row: `id, label, type, zone, capacity, active, hasSeatMap, seatCount`.

### GET `/resources/:id`
The resource. A room with a seat map also has `layout`: `{ rows, cols, seats: [{ row, col, label }] }`. An inactive resource is hidden from non-admins.

### GET `/resources/:id/availability?date=&startTime=&endTime=`
Answers `{ capacity, booked, available }`. `booked` counts the seats of confirmed bookings that overlap the time (a group counts as its size).

### GET `/resources/:id/seats?date=&startTime=&endTime=`
Answers `{ rows, cols, seats: [{ label, row, col, taken }] }`. `taken` is true when a confirmed booking holds that seat at that time. `400` if the room has no seat map or the date or times are wrong, `404` if the room does not exist.

### POST `/resources`
Body: `label`, `type` (one of the [allowed types](#resource-types)), and `capacity` (a whole number, 1 or more); optional `zone`, `active`, `image`, `layout`.
`layout` is `{ "rows": 5, "cols": 8, "cells": [{ "row": 0, "col": 0 }, ...] }`. The server checks it, names the seats and sets `capacity` to the number of seats (a typed capacity is ignored). With a `layout` the `capacity` field is not needed.
Answers `201` with the resource.

### PATCH `/resources/:id`
Body: any of the fields above. `layout` changes the seat map, `"layout": null` removes it. A seat map cannot be changed or removed while the room has upcoming pending, confirmed, unallocated or waitlisted bookings (`409`). Label, type, zone and active can always be edited.

### DELETE `/resources/:id`
`409` while the resource has upcoming bookings. Mark it inactive instead (`PATCH` with `"active": false`): students no longer see it and old bookings keep its name.

---

## Reservations

A booking is a request. It stays `pending` until the admin runs the allocation for its date. After a run exists for a date, new requests for that date are allocated at once on the seats that are left.

| Method and path | Access | Purpose |
|---|---|---|
| POST `/reservations` | auth | make a request |
| GET `/reservations/mine` | auth | my bookings |
| DELETE `/reservations/:id` | requester or admin | cancel a booking |

### POST `/reservations`
Body:

| Field | Required | Notes |
|---|---|---|
| `resourceId` | yes | an active resource |
| `date`, `startTime`, `endTime` | yes | not in the past, times on `:00` or `:30`, end after start |
| `purpose` | no | one of the [purposes](#purposes-and-tiers), default `general_study` |
| `eventDate` | for every purpose except `general_study` | the day of the interview or exam, not before `date`. For `mid_semester_exam` and `end_semester_exam` an [exam window](#exam-windows) of the same kind must cover it |
| `memberEmails` | no | list of the other group members' emails. Each must be a registered user, no repeats, not the requester. The group (1 + members) must fit the room's capacity |
| `preferredSeats` | no | only for a room with a seat map. Seat names like `["A1","A2"]`: they must exist, no repeats, as many as the group size. It is a wish, not a reservation |

Rules checked: the requester is not suspended; nobody in the group has another pending or confirmed booking that overlaps the time (`409`).
Answers `201` with the booking: `status` is `pending`, or `confirmed` or `unallocated` when a run already exists for that date. The booking has `reason`, `priorityScore`, `groupSize`, `preferredSeats`, `seats`, `offer`, `members`.

### GET `/reservations/mine`
My own bookings and the bookings where I am a group member. Each row: `purpose`, `groupSize`, `status`, `reason`, `resource`, `members` (name and email), `isRequester`, `requester { name }`, `preferredSeats`, `seats`, `offer`, `originalResource`, and `queuePosition` for waitlisted rows. An open offer that is too old is marked `expired` when it is read.

### DELETE `/reservations/:id`
A `pending`, `unallocated`, `waitlisted` or `confirmed` booking that has not started becomes `cancelled` and holds no seats. A group member cannot cancel. A started booking cannot be cancelled (`400`). After a confirmed booking is cancelled the waitlist of that room and time is reconsidered.

---

## Alternative offers and the waitlist

| Method and path | Access | Purpose |
|---|---|---|
| POST `/reservations/:id/offer/accept` | requester | accept the alternative room |
| POST `/reservations/:id/offer/reject` | requester | refuse it |
| POST `/reservations/:id/waitlist` | requester | wait for a free seat |

### POST `/reservations/:id/offer/accept`
Accepts the open offer of an `unallocated` booking. The seats and the group's availability are checked again. If it fits, the booking becomes `confirmed` in the offered room (`originalResource` remembers the first choice, the old seat wish is dropped, new seats are given). If it no longer fits, the offer becomes `expired` and the booking stays `unallocated` (`409`). An expired offer answers `409`.

### POST `/reservations/:id/offer/reject`
The offer becomes `rejected`, the booking stays `unallocated`.

### POST `/reservations/:id/waitlist`
Only from `unallocated` (`409` otherwise). The status becomes `waitlisted` and an open offer is closed.

---

## Recommendations

| Method and path | Access | Purpose |
|---|---|---|
| GET `/recommendations` | auth | rooms that fit a group at a time |

### GET `/recommendations?date=&startTime=&endTime=&groupSize=&type=&zone=`
Active resources with enough free seats for the whole group. Order: same type and zone, then same type, then the others; inside each by most free seats, then label. Each row: `id, label, type, zone, capacity, freeSeats, sameType, sameZone`. No seats are held.

---

## Admin: reservations

| Method and path | Access | Purpose |
|---|---|---|
| GET `/admin/reservations` | admin | all reservations |
| POST `/admin/reservations/:id/confirm` | admin | force confirm |
| POST `/admin/reservations/:id/cancel` | admin | cancel |
| POST `/admin/reservations/:id/no-show` | admin | mark a no-show |
| DELETE `/admin/reservations/:id` | admin | delete |

### GET `/admin/reservations?status=&date=`
All reservations with user and resource. Each row: `purpose`, `groupSize`, `priorityScore`, `reason`, `offer`, `preferredSeats`, `seats`, and `queuePosition` for waitlisted rows.

### POST `/admin/reservations/:id/confirm`
Force confirms a `pending`, `unallocated` or `waitlisted` booking. It can skip the priority order but never exceeds the room's capacity (`409` if it does not fit, `409` if someone in the group already has a confirmed booking at that time). It closes an open offer and gives the seats.

### POST `/admin/reservations/:id/cancel`
Cancels the booking. If it was confirmed, the waitlist is reconsidered and `data.waitlistConfirmed` says how many waitlisted requests were confirmed.

### POST `/admin/reservations/:id/no-show`
Only after the booking has started. The status becomes `no_show` and the user's `noShowCount` goes up by one. A no-show lowers the user's [reliability score](#priority-score) for 90 days. It does not suspend the user.

### DELETE `/admin/reservations/:id`
Deletes the booking. Deleting a confirmed booking that has not started also reconsiders the waitlist (`data.waitlistConfirmed`).

---

## Admin: allocation

| Method and path | Access | Purpose |
|---|---|---|
| POST `/admin/allocate` | admin | run the allocation for one date |
| GET `/admin/allocation-runs` | admin | history of the runs |

### POST `/admin/allocate`
Body: `{ "date": "YYYY-MM-DD" }`. Ranks the `pending` and `unallocated` bookings of that date (see [allocation order](#allocation-order)) and allocates them one by one. Each booking becomes `confirmed` (with its seats) or `unallocated` (with a reason). After the run, every booking that ended `unallocated` gets an alternative offer when one is free.
Answers `{ run, offersCreated, decisions }`. `run` has `date, ranAt, considered, confirmed, unallocated, offers`. Each decision has the booking, user, room, status, reason, score and `seats`.
Waitlisted bookings are not part of a run. Running the same date again only considers bookings that are still pending or unallocated.

### GET `/admin/allocation-runs`
The run history, newest first.

---

## Exam windows

An exam window is a period of days with a kind. A student can book for `mid_semester_exam` or `end_semester_exam` only on an event date inside a window of the same kind.

| Method and path | Access | Purpose |
|---|---|---|
| GET `/exam-windows` | auth | list the windows |
| POST `/exam-windows` | admin | add a window |
| DELETE `/exam-windows/:id` | admin | delete a window |

### POST `/exam-windows`
Body: `startDate`, `endDate` (`YYYY-MM-DD`, start not after end), `kind` (`mid_semester_exam`, `end_semester_exam` or `other`); optional `title` (made from the dates if empty).

---

## Messages

Contact messages from users to the admin ("Guardian Hold" messages).

| Method and path | Access | Purpose |
|---|---|---|
| POST `/messages` | auth | send a message to the admin |
| GET `/messages` | auth | the admin sees all, a user sees their own |
| PATCH `/messages/:id` | admin | mark read or reply |
| DELETE `/messages/:id` | admin | delete |

- POST body: `subject` and `message` (both required). Name, email and department are taken from the logged-in user.
- PATCH body: `status` (`unread` or `read`) and/or `reply`.

---

## Health

| Method and path | Access | Purpose |
|---|---|---|
| GET `/health` | public | check that the server is running |

### GET `/health`
Answers `{ "message": "Atlas Room API is running" }`.

---

## Reference: values and rules

### Resource types
`study room`, `discussion_room`, `carrel`, `computer station`, `seminar hall`, `community study hall`, `reading pod`.

### Purposes and tiers
A higher tier always beats a lower tier.

| Purpose | Tier |
|---|---|
| `job_interview` | 5 |
| `end_semester_exam` | 4 |
| `mid_semester_exam` | 3 |
| `quarterly_test`, `project_work` | 2 |
| `general_study` | 1 |

### Reservation statuses
| Status | Meaning |
|---|---|
| `pending` | waiting for the allocation |
| `confirmed` | has its seats |
| `unallocated` | did not fit; may carry one alternative offer |
| `waitlisted` | the student chose to wait for a free seat |
| `cancelled` | cancelled, holds no seats |
| `no_show` | the student did not come |

### Priority score
`score = role score + reliability score`

- Role score: faculty 15, other staff 10, student `(semester / course length) x 10` up to 10 (course lengths: B.Tech 8, BSc 6, BBA 6, M.Tech 4, MSc 4, MBA 4, PhD 8; 8 when unknown).
- Reliability score: 10, minus 3 for every no-show in the last 90 days, never below 0.
- Only the requester's score counts, never the group members'.

### Allocation order
Within one date the requests are ordered by tier (high first), then score (high first), then the earlier request, then id. Only `confirmed` bookings use seats. A group needs as many seats as its size and is never split. A confirmed booking is never bumped, revoked or reduced by a later request or run.

### Alternative offers
A booking that ends `unallocated` gets at most one offer: another active room of the same type with enough free seats for the whole group at the same date and time (same zone first, then most free seats, then label). An offer is a suggestion and holds no seats. It expires at the earlier of `OFFER_MINUTES` (default 60) after it was made and the start of the booking. A booking that starts in less than 5 minutes gets no offer. Offers expire when they are read or answered; there is no background job.

### Waitlist
`waitlisted` is always the student's choice. When a confirmed booking is cancelled or deleted, the waitlisted bookings of the same room and time are tried in the allocation order, each one only if the whole group fits and nobody in it is busy. The queue position is the place in that order (1 = first).

### Seat maps
A room can have a grid of `rows x cols` squares (at most 20 x 30). The squares that hold a seat are named by their row letter and their number in that row, aisles not counted: `A1`, `A2`, ... `B1`. For such a room `capacity` is the number of seats. A room without a seat map works with the capacity number only.

- A seat wish (`preferredSeats`) is only a wish. The request stays `pending` and priority decides who gets the room.
- When a booking is confirmed it gets its `seats`: the wished seats that are still free; otherwise seats side by side in one row; the rest from the free seats nearest to the first one. A seat is never given twice at the same time.
- Only a confirmed booking holds seats. Cancelled, unallocated and waitlisted bookings hold none.
- Allocating one room is done one request at a time on a single server process.
