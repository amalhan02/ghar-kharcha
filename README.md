# Ghar Kharcha – household expense tracker

A small web app for two people sharing one budget. Log daily expenses, pick a category,
and see how much is left this month, per category and against your overall spending cap.

No build step: plain HTML and JavaScript that talks to Supabase. Host it free on GitHub Pages.

## What it does

- **Add an expense in a few taps**: amount, category, date, who paid, which account it came from, optional note.
- **Overview for any month**: money left for day-to-day spending, a per-day figure for the days remaining,
  and spending as a share of in-hand income against your cap.
- **Per-category budgets** with progress bars, grouped into needs and wants, flagged when over.
- **Funds that build up**: trip, luxury, insurance and each person's guilt-free money carry over month to month
  and show a running balance.
- **Fixed bills in one tap**: rent, internet, mobile and similar are logged together each month.
- **History** with filters by category and person, edit, delete and CSV export.
- **Settings**: change income, the cap, category names and budgets, add categories.
- **Two logins, one budget**: each expense records who paid.

Savings (PPF, NPS and so on) are not tracked here; this app covers spending only.

## Setup (about 15 minutes)

1. **Supabase project**: create a project at supabase.com. Each of you needs nothing else there.
2. **Database**: open SQL Editor, paste the whole of `supabase/schema.sql`, and run it once.
   It creates the tables, the security rules and your starting categories and budgets.
3. **Keys**: in Project Settings > API, copy the Project URL and the anon (publishable) key into `config.js`.
   Do not use the service_role key.
4. **Host it**: push this folder to a GitHub repo, then Settings > Pages > Deploy from branch > `main`, root folder.
   Note that a free GitHub Pages site needs a public repo; the code has no secrets in it, and your data stays in Supabase.
5. **Create both accounts**: open the site, use "Create account" once for each of you.
   If Supabase asks you to confirm by email, do that, then sign in.
6. **Lock it down**: in Supabase > Authentication > Sign In / Providers, turn off new user sign-ups.
   This matters: any signed-in user can see and edit the household data, so only the two of you should have accounts.
7. **Add to your phones**: open the site in the browser and choose "Add to Home Screen".

## Things to change first

- Set your combined monthly in-hand income and spending cap in Settings.
- Add your categories and monthly budgets in Settings (personal figures are deliberately not kept in this repo).
- Fund balances build up from the month in "Funds build up from"; change it in Settings if you start later.

## Files

- `index.html` – page shell and styles
- `app.js` – the app
- `config.js` – your Supabase URL and anon key
- `supabase/schema.sql` – tables, security rules, starting data

## Troubleshooting

If something fails, the error message shows as a small banner at the bottom of the screen.
