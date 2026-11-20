# Jeweltech demo

## Run locally

Start the backend in one terminal:

```powershell
cd backend
npm install
npm run dev
```

Start the frontend in a second terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the frontend terminal. Choose **Demo jeweller** or
**Demo karigar** and select **Continue**. The sign-in screen fills the seeded
demo phone and PIN (`1234`); demo phones are `111` for a jeweller and `333` for
a karigar. Sign-in requires the backend to be running.

The jeweller portal includes **Dashboard**, **Karigars**, **Orders**,
**Customers**, **Ledger**, and **Settings**. The customer workflow runs from
recording a customer order, assigning it to a karigar, and completing the
karigar work slip through acknowledgement. Once work is acknowledged, the
jeweller can record a demo customer update with the reported wastage compared
with its allowance. This is a local demo action and does not send a message or
open an external link. The karigar signs in to his own paper-slip view.

The customer and karigar demo ledger is stored in this browser's local storage;
it is separate from the backend SQLite ledger. Existing local demo data is
preserved when you sign out or restart the app. Do not use **Reset demo** or
`npm run seed` if you need to preserve local demo data. Demo rates and example
transactions are labelled SIMULATED or SYNTHETIC.

`npm run seed` resets the local synthetic database. Do not run it if you need to
preserve local demo data.

## Frontend checks

```powershell
npm run test:routes
npm run lint
npm run build
```
