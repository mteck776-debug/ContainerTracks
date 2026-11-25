# ContainerTracks

Tracks the 6 container bays in the yard: what's in each container, how many bales, the estimated weight, and a predicted weighbridge reading when a truck swaps an empty for a full.

It's a single `index.html` file with no install and no server. Open it in a browser or host it on GitHub Pages.

## Run it

- **GitHub Pages:** go to repo **Settings → Pages**, set Source to *Deploy from a branch*, then pick `main` / `(root)`. The site appears at `https://mteck776-debug.github.io/ContainerTracks/`.
- **Locally:** double-click `index.html`.

## What it does

| Tab | Purpose |
|---|---|
| **Yard** | Six bays. Each shows its container number, tare, material, bale count (−/+1/+5 or type it in), estimated load and gross. |
| **Truck swap** | Records a full container leaving and the empty one replacing it, and predicts the weigh-out. |
| **Containers & Trucks** | **Tare by prefix** list (e.g. `AFDB → 4.60 t`), the container register, and the trucks the app has learned. |
| **Materials** | OCC, MXP, ALI, HDPE C, Steel, each with an average tonnes per bale and a **target bales** default. You can add more. |
| **History** | Every dispatched load. Add the actual weigh-out here to see actual load, actual tonnes per bale and how far off the prediction was. Exports to CSV. |
| **Backup** | Download or restore a JSON backup. |

## Target bales

Each material has a default number of bales to aim for per container. You can override it on any bay card by typing into its **Target** box. The **use default** link sets it back to the material's default.

The bay card shows bales / target, a progress bar and how many bales are left to go. The card turns **green** when the target is reached and **amber** when it goes over. The Yard summary counts how many containers are at target, and each dispatched load records its target in History.

## Tare by prefix

Save one tare per container prefix, for example `AFDB → 4.60 t`. When a container comes in, the app checks the start of its number against the prefix list and uses the longest prefix that matches (`AFDB 123456` → 4.60 t). 

- Leave a container's tare blank to use its prefix tare. Changing a prefix tare later updates every container that uses it.
- Typing a tare for one container overrides the prefix tare for that container only.
- If a new container's prefix isn't on the list, enter its tare once and tick **Save as the tare for prefix XXXX**. After that, any container with that prefix fills its tare in automatically.

## How the weigh-out prediction works

```
Truck arrives with empty:  weigh-in   = truck tare + empty container tare
So:                        truck tare = weigh-in − empty container tare

Truck leaves with full:    predicted weigh-out = truck tare
                                               + full container tare
                                               + bales × avg tonnes per bale
```

If you enter a truck rego the app remembers that truck's tare. When the same truck comes back, choosing its rego gives a prediction before it reaches the bridge.

Once a load has an actual weigh-out, the app works out the real average tonnes per bale for that material. The **Materials** tab shows it under *Learned*, and **Use** makes it the new average.

## Data & sign-in (Firebase)

The data is shared live between every device through the **Containers** Firebase project (`containers-73d69`). Everyone signs in with an email and password, and a change made on one device shows up on the others straight away. If the signal drops, the app keeps working and syncs when it's back online.

**One-time setup in the Firebase console**
1. **Firestore Database** → Create database → production mode, location `australia-southeast1` (Sydney).
2. **Firestore Database → Rules** → paste in [`firestore.rules`](firestore.rules), put the allowed email addresses in the list, then click **Publish**.
3. **Authentication → Sign-in method** → enable **Email/Password**.
4. **Authentication → Users** → **Add user** for each person (email + starting password). They can use *Forgot password?* on the sign-in screen to set their own.
5. **Authentication → Settings → Authorized domains** → add `mteck776-debug.github.io`.

To add someone later, add them as a user (step 4) **and** add their email to the rules list (step 2).

The connection settings are in `firebase-config.js`. If you set that file to `null`, the app runs on a single device with browser storage only.

On first sign-in, if the shared database is empty, the app offers to upload the data already on that device.

All weights are shown and entered in **tonnes**: tares, weigh-ins and weigh-outs, and bale weights (e.g. 0.450 t). The default bale weights (OCC 0.450, MXP 0.500, ALI 0.300, HDPE C 0.300, Steel 0.450 t) are placeholders. Set them to your own figures in **Materials**.
