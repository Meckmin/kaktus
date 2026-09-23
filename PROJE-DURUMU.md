# Kaktüs Koçluk — Where We Are

A plain-language summary of everything built so far, why it was built that way, and
what comes next. No technical detail — this is the version you could hand to an
investor, a lawyer, or a new teammate on their first day.

---

## 1. What we are building

Most YKS coaching sold online works like a shop: a company packages a programme,
sets a price, assigns whichever coach is free, and the student takes it or leaves it.

Kaktüs Koçluk works like a marketplace instead. Students describe where they are and
where they want to get to. Coaches set their own prices and choose their own
students. The two sides find each other, agree their own terms, and Kaktüs sits in
the middle doing three jobs: **matching them, holding the money safely, and stepping
in when something goes wrong.**

We earn a commission — currently 18% — and only on lessons that actually happen.

The name carries the idea. A cactus survives in hard conditions and blooms anyway.
That is what a gap year looks like from the inside.

---

## 2. The journey so far

### Stage one — The blueprint

Before writing anything, we mapped out how the whole system fits together: what
information we need to store, how a student and coach move from "never met" to
"working together", and where money changes hands.

This sounds like paperwork, but it decided things that would have been painful to
change later. For example: we decided early that Kaktüs would never hold student
money in its own bank account. That single decision keeps us out of a category of
financial regulation that would require a licence, an audit, and a compliance team.

We also wrote down the rules the system must never break — like "the same hour can
never be booked twice" and "money can never disappear or appear from nowhere" — and
built them into the foundations rather than trusting ourselves to remember.

### Stage two — The matching brain

This is the part that makes Kaktüs different from a directory.

When a student answers our questions, we score every available coach against them
across seven dimensions and rank the results. The heaviest single factor — and this
is the product's core bet — is **whether the coach personally made a similar climb.**
A coach who went from 45 to 95 net is real evidence for a student who needs to go
from 40 to 90. Nobody else in the Turkish market ranks coaches this way.

The other factors are working style, matching free hours, subject depth, budget fit,
past student feedback, and experience with that specific year group (11th grade, 12th
grade, or gap year).

Two deliberate choices inside it:

- **New coaches get a small visibility boost.** Without it, whoever joined first
  would permanently dominate and new coaches would never get a first student.
- **One five-star review does not beat fifty four-and-a-half-star reviews.** The
  scoring accounts for how much evidence exists, not just the average.

Students see not only a match percentage but *why* — short explanations under each
coach. An unexplained ranking is something teenagers are right to distrust.

### Stage three — The agreement system

A student and coach negotiate. Someone proposes terms, the other accepts or counters,
and eventually they agree. Then payment happens, lessons happen, and it ends.

We built a strict rulebook covering every stage an agreement can be in and every
legal move between them. Nothing can skip a step. You cannot start lessons before
paying. You cannot cancel something already paid for — that becomes a refund, which
is a different and more careful process. An agreement that has finished can never
quietly reopen.

The reason for the strictness is that every one of those stages involves someone's
money and someone's exam year.

We also handled the awkward real-world cases. When a student proposes specific hours,
those hours are **held** — locked so nobody else can take them while the coach
decides. If the coach counters with different terms, the held hours transfer to the
new proposal rather than being released and grabbed by someone else. If nobody
responds, the hold quietly expires and the hours go back to the calendar.

### Stage four — Money and trust

This is the heart of why a marketplace like this can work at all.

When a student pays, **the money does not go to the coach.** It is held. As lessons
are completed, it is released in weekly instalments. If the coach does not show up,
the student can raise a dispute and the unreleased money can be refunded.

Two rules we settled on, and both matter:

**Silence means approval, after five days.** Requiring both sides to actively confirm
every week sounds fairer and fails in practice — students vanish after the exam, and
coaches end up unpaid for work they genuinely did. Coaches would learn not to trust
the system and start pushing students to pay them directly. So if nobody objects
within five days, the instalment releases automatically. A reported no-show blocks
that release regardless of the clock.

**Completed instalments are final.** If weeks one and two went well and week three
goes badly, the coach keeps the money for weeks one and two. Earnings that can be
retroactively cancelled are not really earnings, and no good coach would build their
income on them.

Underneath all of this, every movement of money is recorded twice, in a way that makes
the books provably balanced. If the numbers ever disagree, the system refuses the
transaction rather than continuing with a quiet error.

### Stage five — Actually taking payments

We integrated İyzico, the standard payment provider for Turkish marketplaces.

Something important came out of reading their documentation carefully: **İyzico holds
the escrow, not us.** Money sits with them after the card is charged and moves to the
coach only when we tell them to release it. This is better than our original plan —
it is exactly the arrangement that keeps us out of financial licensing territory.

It also changed a technical detail with a real consequence: because their system
releases money one basket line at a time, we now send each weekly instalment as its
own line. Had we not caught this, releasing week one without releasing weeks two
through four would have been impossible.

We built the whole payment path so it can be tested locally without a merchant
account, using a simulator. Card fraud checks, forged payment notifications, and
duplicate notifications are all handled — a fake "payment successful" message from an
attacker gains them nothing, because we ignore it and independently ask İyzico what
actually happened.

### Stage six — The student experience

A student lands on the site and answers five questions: their subject area and year,
their target ranking, their current scores, what kind of coach suits them, and their
budget. **No signup required.** They see real matched coaches immediately.

The signup wall sits between *looking* and *doing*. Browse freely; to message a coach
or send an offer, you need an account.

The answers are kept safely so nothing is lost at that moment. We were careful here
because of a specific failure we anticipated: a student starts in one browser, the
login email opens in a different one, and their five answers vanish. We store them in
a way that survives that.

Rather than a progress bar, the questionnaire builds a visible profile down the side
of the screen — each answer appears as you give it. It makes the form feel like
assembling something rather than filling something in, and it makes the promise "we
kept your answers" something you can actually see.

### Stage seven — Coach profiles and making an offer

Each coach has a page showing their verified ranking, university, their own score
improvement, how they work, and reviews from students who completed a programme with
them. Reviews show initials only — the students are minors.

The calendar shows genuinely available hours, hours already booked, and — separately —
hours currently held in someone else's open negotiation. That third state matters: held
hours often free up within hours, and hiding them would make a popular coach look
unreachable and push the student toward a worse match.

From there a student builds an offer: a single trial session or a four-week programme,
specific hours, and their own price. The price breakdown shows the full picture
including our commission, before they commit. We show our own cut openly and
deliberately — a marketplace that hides its fee until the receipt teaches people to
arrange things privately next time.

If they are not signed in, the offer is saved, they sign in, and it sends
automatically. They never re-enter anything.

### Stage eight — Becoming a coach

Coaches apply through a form covering their university and department, their verified
ranking with document proof, how they coach, who they want to work with, their prices
and capacity, and their payment details.

Applications go to a review queue. Nobody appears in search results until a human has
checked their documents. After applying, coaches see a clear status page explaining
what happens next and roughly how long it takes — written specifically to remove the
urge to email support.

Sensitive details like ID and bank account numbers are encrypted, kept apart from the
rest of the profile, and can be deleted once İyzico has them. They exist only because
the payment provider requires them.

### Stage nine — Protecting the commission

If a coach and student swap phone numbers and arrange privately, both lose the payment
protection and Kaktüs earns nothing. So messages are checked for phone numbers, bank
details, and social media handles.

The hard part was Turkish. People write numbers as words, add dots between digits, use
abbreviations. The system handles all of that. Equally important, it does **not** flag
normal exam conversation — "I was ranked 480,000" and "I'm at 55 net" pass through
untouched. A filter that eats exam vocabulary in an exam-prep product is worse than no
filter.

When something is blocked, we say so and explain why. People work around filters they
do not understand and mostly accept ones they do.

### Stage ten — Quality checks and fixes

Along the way we checked the parts where being wrong is expensive:

- The payment security calculations were tested against İyzico's own published
  example and match exactly.
- ID and bank account number checks catch typos — including swapped digits, the most
  common mistake — before a coach is approved and discovers weeks later they cannot be paid.
- Commission splitting was tested to confirm not a single kuruş is ever lost or
  invented, including awkward amounts that do not divide evenly.
- The "two students click the same hour at the same instant" scenario was tested
  repeatedly. Exactly one wins, every time.
- Recently, a full check of the code found two genuine errors that would have stopped
  the site from building, and six links pointing at pages that did not exist yet —
  including the page a student lands on *after successfully paying*. All fixed.

---

## 3. Where things stand honestly

**Working and checked:** the matching system, the agreement rules, the money handling
and escrow logic, the payment integration, the student questionnaire and results, coach
profiles with calendars, the offer builder, the coach application, and the message filter.

**Built but never actually run:** all of it. The development environment used to build
this has no internet access and no database, so while the logic has been tested in
isolation and the code has been checked for errors, **nothing has been loaded in a real
browser against a real database yet.** Expect some rough edges on the first run.

**Not built yet:** the chat and negotiation screen, the coach's own dashboard for
accepting offers, the admin review tools, and the detailed calendar editor.

---

## 4. What to do next

### Immediately — get it running

Install it, connect a database, and open it in a browser. Walk through it as a student:
answer the questions, look at your matches, open a coach, build an offer, sign in.
Then as a coach: apply, and see the status page.

Send me anything that breaks. Fixing errors from a description is something this process
has already done well twice.

One thing to be careful about: there is a specific database setup step that must be run,
which installs the protections preventing double-booking and accounting errors. If it is
skipped, everything will *appear* to work perfectly and then double-book a coach in
production. It is written down in the setup instructions.

### Next — the missing middle

The biggest gap is the **negotiation screen**: where a student and coach message each
other, counter-offers get made, and a deal is accepted. Right now a student can send an
offer but neither side has a place to talk about it. This is the single most valuable
thing to build next.

Right after that, the **coach's dashboard** — accepting, countering, managing students.

Then the **admin tools** for reviewing coach applications and handling disputes. These
can be rough at first; you can do them by hand for the first dozen coaches, and you will
learn what the tools actually need to do by doing it manually.

### Before taking real money

- Test the full payment flow against İyzico's test environment, including 3D Secure.
  Our simulator cannot reproduce every real-world case.
- Get the legal documents in place: the service agreement, the intermediary service
  provider disclosure Turkish e-commerce law requires, and a privacy policy covering how
  we handle student and coach data.
- Decide how document verification actually works day to day — who checks them, against
  what standard, how fast.
- Move the encryption of sensitive data to a proper key-management service.

### Decisions that need you, not me

- **The commission rate.** 18% is set as a default, not a researched number.
- **The five-day auto-release window.** Reasonable, but you may want longer at launch
  while trust is being established.
- **Which side to recruit first.** A marketplace with no coaches has nothing to show
  students; a marketplace with no students loses its coaches. Most solve this by
  hand-recruiting a small number of excellent coaches and starting narrow — one subject
  area, or one city.
- **The verification standard.** How strictly do we check ranking documents? This is the
  single thing the whole product's credibility rests on.

---

*Last updated after the route and code-quality pass.*
