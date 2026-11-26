# MRF Life

Tracks the 6 container bays in the yard: what's in each container, how many bales, the estimated weight, and a predicted weighbridge reading when a truck swaps an empty for a full.

It's a single `index.html` file with no install and no server. Open it in a browser or host it on GitHub Pages.

## Run it

- **GitHub Pages:** go to repo **Settings → Pages**, set Source to *Deploy from a branch*, then pick `main` / `(root)`. The site appears at `https://mteck776-debug.github.io/MRF Life/`.
- **Locally:** double-click `index.html`.

## What it does

| Tab | Purpose |
|---|---|
| **Containers** | Six bays. Each shows its container number, tare, material, bale count (−/+1/+5 or type it in), estimated load and gross. |
| **Book** | Asks whether the container is already booked. If **No**: opens the [Linfox Customer Portal](https://portal.linfox.com/) and shows a **booking sheet** laid out like the Linfox form: connote number, customer reference, container number, pickup details, delivery and freight details. Each field has its own **Copy** button, and **Copy all** copies the lot. Click **Mark as booked** once it's submitted. If **Yes**: record the order number used. The bay shows the booking until the truck swap, and the order number goes into History. |
| **Day Sheet** | Trucks (e.g. 9 axle B-doubles) loaded with bales. Add the company, commodity and truck setup. When the truck arrives, add its rego and tare, and the sheet shows how many tonnes and **how many bales** it can take. Add bales loaded and the weigh-out to get the net. You can plan future loads on any date, see them under **Upcoming loads**, and print the sheet. Company names and truck tares are remembered. |
| **CRS Lots** | Containers for Change lots (CRS ALI, CRS PET Clear …) by lot number (e.g. `#L51528`), with bales and total weight. Lots move from **On auction** to **Sold – awaiting transport**, then **Transport booked** (company and pickup date), then **Collected**. Sold lots show on the Day Sheet as *awaiting transport* with bale totals per commodity. Booked transport becomes a Day Sheet pickup on its date, and entering the weigh-out there marks the lot collected. |
| **Truck swap** | Records the 1st weigh (truck in) and 2nd weigh (truck out, loaded) and works out the net weight of material. The empty container takes over the bay. |
| **Setup** | All the background data on one page, with a jump menu at the top: **Materials** (bale weights, targets, delivery location), **CRS commodities**, **Delivery locations** (add more, set delivery instructions, upload weight declaration forms), **Linfox bookings** (connote sequences, details that go on every booking), **Container tares** by prefix, **Container register**, **Vehicles** (rego, tare, setup), **Truck setups** (max gross, safety buffer), **Companies** and **Backup**. |
| **Reports** | Every dispatched load with both weighings, the net weight, tonnes per bale and the difference from the bale estimate. Exports to CSV. |

## Target bales

Each material has a default number of bales to aim for per container. You can override it on any bay card by typing into its **Target** box. The **use default** link sets it back to the material's default.

The bay card shows bales / target, a progress bar and how many bales are left to go. The card turns **green** when the target is reached and **amber** when it goes over. The Yard summary counts how many containers are at target, and each dispatched load records its target in Reports.

## Day sheet: how many bales fit

```
Can carry        = max gross for the truck setup − truck tare − safety buffer (0.5 t by default)
Suggested bales  = can carry ÷ bale weight                       (capped by the setup's max bales, if set)
```

The bale weight comes from previous **weighed pickups** of that commodity on the day sheet. With none yet, it uses loads weighed out of containers, then the Materials average. If the same truck (rego) has picked up before, the row also shows what it took last time.

Example: 9 axle B-double, tare 20.5 t → 62.5 − 20.5 − 0.5 = 41.5 t. Previous OCC pickups averaged 0.462 t per bale → **89 bales**.

The default max gross figures are the general mass limits: 9 axle B-double 62.5 t, 8 axle 59.0 t, 6 axle semi 42.5 t. Change them under **Truck setups** if a truck runs under HML or a permit. Weighed day-sheet loads also feed the learned bale weights.

## Linfox order numbers

Each material has its own order number sequence. You can edit them in **Setup**:

| Material | Format | Last used (starting point) |
|---|---|---|
| OCC | `CRCMRF-OCC####` | CRCMRF-OCC0109 |
| MXP | `CRCMRF-MXP####` | CRCMRF-MXP0121 |
| HDPE C | `CRCMRF-HDCO###` | CRCMRF-HDCO001 |
| ALI | `CRCMRF-MALU###` | CRCMRF-MALU001 |
| Steel | not set yet | |

The next booking uses *last used + 1*.

**Booking sheet wording** (example: 48 bales of aluminium in AFDB4130117):
- Customer reference: `48 x MRF Aluminium Bales - AFDB 413 011 7`
- Pickup instructions: `48 x MRF Aluminium Bales - 40ft empty required for exchange, AFDB 413 011 7`
- Product description: `48 x MRF Aluminium Bales`. Product type is 12.2M/40" Container General, quantity 1, weight 18000 kg (Linfox minimum charge).
- Delivery goes to **Genuine Recycling Group** with no instructions, except **Mixed Paper**, which goes to **Visy** with *Booking required, Driver must quote - VWI 18811638*.

**Weight declaration PDFs.** On the **Setup** tab, upload a fillable PDF for each delivery location (Genuine Recycling, Visy, …) and choose what goes in each of its boxes: container number, tare, today's date, bale count, description, connote number or commodity. Bookings to that location then get a **Weight declaration PDF** button that fills it in, ready to print. Forms are stored in the app's Firebase database, never in this public repo.

You can change all of these in Setup: name on booking, delivery location and instructions for each material, plus the booking details that are the same every time (email, phone, depot and so on). If you type a number that's further along the sequence, the sequence jumps forward to match.

## Tare by prefix

Save one tare per container prefix, for example `AFDB → 4.60 t`. When a container comes in, the app checks the start of its number against the prefix list and uses the longest prefix that matches (`AFDB 123456` → 4.60 t). 

- Leave a container's tare blank to use its prefix tare. Changing a prefix tare later updates every container that uses it.
- Typing a tare for one container overrides the prefix tare for that container only.
- If a new container's prefix isn't on the list, enter its tare once and tick **Save as the tare for prefix XXXX**. After that, any container with that prefix fills its tare in automatically.

## Truck swap: net weight from the two weighings

The truck is weighed coming in (with an empty, or bare) and weighed going out with the loaded container:

```
Net material = 2nd weigh (out, loaded)
             − 1st weigh (in)
             + tare of the empty container it brought in   (nothing if it came in bare)
             − tare of the full container it took
```

Example: 38.50 out − 18.60 in + 4.60 empty − 4.60 full = **19.90 t net**.

- **Save weigh-in, weigh out later:** after the 1st weigh, save it. The bay shows *🚛 rego on site* and its button changes to **Weigh out**. Open it at the 2nd weigh, enter the weight, and click **Complete swap**.
- While the truck is on site, the app shows an *expected* 2nd weigh based on the bale count, so you can spot anything way off.
- The bale estimate stays on screen as a cross-check, and each weighed load teaches the app the real tonnes per bale (see Setup).
- A load completed without a 2nd weigh shows *needs 2nd weigh* in Reports. Click **Edit** to add it.
- Each truck's tare (1st weigh − empty tare) is remembered by rego.

## Data (Firebase)

The data is shared live between every device through the **Containers** Firebase project (`containers-73d69`). There's no login screen: the app signs in silently in the background (Firebase anonymous sign-in) and opens straight to the yard. If the signal drops, the app keeps working and syncs when it's back online.

**One-time setup in the Firebase console**
1. **Firestore Database** → Create database → production mode, location `australia-southeast1` (Sydney).
2. **Firestore Database → Rules** → paste in [`firestore.rules`](firestore.rules) → **Publish**.
3. **Authentication** → Get started → **Sign-in method** → enable **Anonymous**.

Anyone with the app's link can view and change the data. To lock it down to named people later, set `CT_REQUIRE_LOGIN = true` in `firebase-config.js`, enable Email/Password sign-in, add users, and limit the rules to their emails.

The connection settings are in `firebase-config.js`. If you set that file to `null`, the app runs on a single device with browser storage only.

On first sign-in, if the shared database is empty, the app offers to upload the data already on that device.

All weights are shown and entered in **tonnes**: tares, weigh-ins and weigh-outs, and bale weights (e.g. 0.450 t). The default bale weights (OCC 0.450, MXP 0.500, ALI 0.300, HDPE C 0.300, Steel 0.450 t) are placeholders. Set them to your own figures in **Materials**.
