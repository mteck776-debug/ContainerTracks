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
| **Materials** | OCC, MXP, ALI, HDPE C, Steel, each with an average kg/bale and a **target bales** default. You can add more. |
| **History** | Every dispatched load. Add the actual weigh-out here to see actual load, actual kg/bale and how far off the prediction was. Exports to CSV. |
| **Backup** | Download or restore a JSON backup. |

## Target bales

Each material has a default number of bales to aim for per container. You can override it on any bay card by typing into its **Target** box. The **use default** link sets it back to the material's default.

The bay card shows bales / target, a progress bar and how many bales are left to go. The card turns **green** when the target is reached and **amber** when it goes over. The Yard summary counts how many containers are at target, and each dispatched load records its target in History.

## Tare by prefix

Save one tare per container prefix, for example `AFDB → 4.60 t`. When a container comes in, the app checks the start of its number against the prefix list and uses the longest prefix that matches (`AFDB 123456` → 4,600 kg). You can type tares in tonnes (`4.6`) or kg (`4600`).

- Leave a container's tare blank to use its prefix tare. Changing a prefix tare later updates every container that uses it.
- Typing a tare for one container overrides the prefix tare for that container only.
- If a new container's prefix isn't on the list, enter its tare once and tick **Save as the tare for prefix XXXX**. After that, any container with that prefix fills its tare in automatically.

## How the weigh-out prediction works

```
Truck arrives with empty:  weigh-in   = truck tare + empty container tare
So:                        truck tare = weigh-in − empty container tare

Truck leaves with full:    predicted weigh-out = truck tare
                                               + full container tare
                                               + bales × avg kg/bale
```

If you enter a truck rego the app remembers that truck's tare. When the same truck comes back, choosing its rego gives a prediction before it reaches the bridge.

Once a load has an actual weigh-out, the app works out the real average kg/bale for that material. The **Materials** tab shows it under *Learned*, and **Use** makes it the new average.

## Data

All data is saved in the browser it's used in (localStorage), so each PC or tablet keeps its own copy. Use **Backup** to move data between devices or keep a safe copy.

The default bale weights (OCC 450, MXP 500, ALI 300, HDPE C 300, Steel 450 kg) are placeholders. Set them to your own figures in **Materials**.
