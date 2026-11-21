# Marcador y Parley

Página: https://johnhmr90-lgtm.github.io/parley/

- `index.html`: la página (marcadores en vivo de ESPN, pronósticos, parley del día y efectividad).
- `data/days/`: un archivo por día con partidos, momios y el parley fijado.
- `tools/`: scripts que descargan los datos (`update.py`), fijan el parley (`finalize.js`, `model.js`) y arman la página (`build.js`, `page.html`).
- `.github/workflows/actualizar.yml`: corre cada hora y actualiza todo solo.
