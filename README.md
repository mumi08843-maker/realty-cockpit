# Realty Cockpit

A Windows-first, local real-estate market cockpit built with React, TypeScript, Tauri, and SQLite.

## Features

- Seattle market overview with inventory and market indicators
- Property collection with status and text filters
- Add and edit property records in the local portfolio
- Import property CSV files with validation and address-based updates
- Create full SQLite backups and restore them with validation and a safety copy
- Check for and install cryptographically verified Windows app updates
- Expanded property files with core home details and private viewing notes
- Interactive, illustrative neighborhood map with neighborhood inventory drill-down
- Market comparison and saved-search views
- Native-app data and notes stored in a local SQLite database

The browser preview uses sample data for visual review. Edits and imports in the browser preview remain in memory for that session. In the desktop app, property records and notes are stored in SQLite under the current Windows user's application data directory, not beside the installed program. On first launch, the app migrates a valid legacy database from the previous working-directory location when one is found.

Each Windows user has a separate local database. Uninstalling or updating the app does not intentionally delete this user data. Use **Backup & restore** in the desktop app to save a portable SQLite database containing property records and private notes. Keep the backup somewhere separate from the computer; restoring validates the selected database and preserves the current database beside the active one before replacement. Backups can be moved to another device and restored from the same dialog.

### Windows updates and releases

The in-app updater checks the public GitHub Releases feed for `mumi08843-maker/realty-cockpit`. Updates are signature-verified before installation. The repository must be public for the updater to download release assets without embedding an access token in the app.

The updater private key is kept outside this workspace at `%LOCALAPPDATA%\Realty Cockpit\updater.key`. Back it up securely. Never commit it, publish it, or put it in a release asset. Losing it prevents signing future updates for already-installed copies. The matching public key is stored in the Tauri configuration and is safe to publish.

Windows releases are automated by [`.github/workflows/release.yml`](./.github/workflows/release.yml). Before the first automated release, add a repository Actions secret named `TAURI_SIGNING_PRIVATE_KEY` containing the full contents of the local `updater.key` file. This project’s key has no password, so `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` may remain unset. To add the secret, open the GitHub repository’s **Settings → Secrets and variables → Actions → New repository secret**. Never paste the private key into an issue, chat, source file, or workflow log. Keep a secure offline backup of the same key.

To publish a future update:

1. Make sure the project source and workflow are committed and pushed to `main`.
2. Update the app version to the same new SemVer value in `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
3. Commit and push those changes.
4. Create and push a matching version tag, such as `v0.1.4`. In PowerShell, run `git tag v0.1.4` and `git push origin v0.1.4`.
5. GitHub Actions builds and signs the NSIS/MSI installers, publishes a GitHub release, and uploads the updater manifest and signatures. Check the **Actions** tab if the workflow fails.

The existing v0.1.3 release was published manually; future tagged releases use the workflow. The local `scripts/prepare-release.ps1` remains available for preparing and signing release assets without GitHub Actions.

### CSV import format

The required CSV columns are `address`, `price`, `beds`, and `neighborhood`. Optional columns are `baths`, `sqft`, `year_built`, `property_type`, `description`, `status`, and `days_on_market`. Header aliases such as `asking price`, `bedrooms`, `bathrooms`, `square feet`, and `district` are accepted. Prices may use dollar signs and commas or `K`/`M` suffixes. Importing an existing address updates its property details and preserves private notes.

## Run locally

Install the Node.js and Rust toolchains required by Tauri, then run:

```powershell
npm install
npm run tauri dev
```

For a frontend-only browser preview:

```powershell
npm run dev
```

The preview runs at `http://localhost:1420`.

## Build

```powershell
npm run build
npm run tauri build
```

Windows installer bundles are written under `src-tauri/target/release/bundle`.
