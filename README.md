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
| **Containers & Trucks** | Register of container numbers and their tares, plus the trucks the app has learned. |
| **Materials** | OCC, MXP, ALI, HDPE C, Steel, each with an average kg/bale. You can add more. |
| **History** | Every dispatched load. Add the actual weigh-out here to see actual load, actual kg/bale and how far off the prediction was. Exports to CSV. |
| **Backup** | Download or restore a JSON backup. |

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
