# Connect to local models instead of bundling inference

NovelForge connects to text and image servers the user already runs and does not ship inference runtimes. Bundling GPU inference would make the download far larger and make GPU support bigger than the app itself. "No extra install" therefore applies to NovelForge and the OpenRouter path, while Local is an advanced option; the adapter boundary leaves room to bundle later.
