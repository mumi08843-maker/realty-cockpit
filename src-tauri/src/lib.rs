use rusqlite::backup::Backup;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::Duration;
use tauri::{AppHandle, Manager};

static DATABASE_OPERATION_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Serialize)]
struct Stat {
    label: String,
    value: String,
    trend: String,
}

#[derive(Clone, Serialize)]
struct Listing {
    address: String,
    price: String,
    beds: i32,
    baths: f64,
    sqft: i32,
    year_built: i32,
    property_type: String,
    description: String,
    notes: String,
    status: String,
    neighborhood: String,
    days_on_market: i32,
}

#[derive(Clone, Serialize)]
struct Neighborhood {
    name: String,
    median: String,
    yoy: String,
    active_listings: i32,
}

#[derive(Clone, Serialize)]
struct DashboardData {
    stats: Vec<Stat>,
    listings: Vec<Listing>,
    neighborhoods: Vec<Neighborhood>,
    searches: Vec<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListingInput {
    address: String,
    price: i64,
    beds: i32,
    baths: f64,
    sqft: i32,
    year_built: i32,
    property_type: String,
    description: String,
    status: String,
    neighborhood: String,
    days_on_market: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportResult {
    created: usize,
    updated: usize,
}

fn validate_listing(listing: &ListingInput) -> Result<(), String> {
    if listing.address.trim().is_empty() {
        return Err("Property address is required.".to_string());
    }
    if listing.address.chars().count() > 300 {
        return Err("Property address must be 300 characters or fewer.".to_string());
    }
    if listing.price <= 0 {
        return Err("Price must be greater than zero.".to_string());
    }
    if !(0..=50).contains(&listing.beds)
        || !(0.0..=50.0).contains(&listing.baths)
        || listing.sqft < 0
        || listing.sqft > 2_000_000
        || !(0..=2200).contains(&listing.year_built)
        || !(0..=10000).contains(&listing.days_on_market)
    {
        return Err("One or more property details are outside the allowed range.".to_string());
    }
    if listing.neighborhood.trim().is_empty() || listing.status.trim().is_empty() {
        return Err("Neighborhood and status are required.".to_string());
    }
    if listing.neighborhood.chars().count() > 120 || listing.status.chars().count() > 40 {
        return Err("Neighborhood or status is longer than the allowed limit.".to_string());
    }
    if listing.description.chars().count() > 5000 {
        return Err("Description must be 5,000 characters or fewer.".to_string());
    }
    if listing.property_type.trim().is_empty() {
        return Err("Property type is required.".to_string());
    }
    if listing.property_type.chars().count() > 100 {
        return Err("Property type must be 100 characters or fewer.".to_string());
    }
    Ok(())
}

fn write_listing(
    conn: &Connection,
    listing: &ListingInput,
    original_address: Option<&str>,
    allow_existing_update: bool,
) -> Result<bool, String> {
    if let Some(original_address) = original_address {
        let duplicate_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM listings
                 WHERE lower(trim(address)) = lower(trim(?1))
                   AND lower(trim(address)) != lower(trim(?2))",
                params![listing.address.trim(), original_address],
                |row| row.get(0),
            )
            .map_err(|err| format!("failed to check for duplicate property addresses: {err}"))?;

        if duplicate_count > 0 {
            return Err(format!(
                "A property with the address “{}” already exists.",
                listing.address.trim()
            ));
        }

        let updated = conn
            .execute(
                "UPDATE listings SET address = ?1, price = ?2, beds = ?3, baths = ?4,
                    sqft = ?5, year_built = ?6, property_type = ?7, description = ?8,
                    status = ?9, neighborhood = ?10, days_on_market = ?11
                 WHERE address = ?12",
                params![
                    listing.address.trim(),
                    listing.price,
                    listing.beds,
                    listing.baths,
                    listing.sqft,
                    listing.year_built,
                    listing.property_type.trim(),
                    listing.description.trim(),
                    listing.status.trim(),
                    listing.neighborhood.trim(),
                    listing.days_on_market,
                    original_address
                ],
            )
            .map_err(|err| format!("failed to update property: {err}"))?;
        if updated == 0 {
            return Err("The property being edited could not be found.".to_string());
        }
        return Ok(false);
    }

    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM listings WHERE lower(trim(address)) = lower(trim(?1))",
            [listing.address.trim()],
            |row| row.get(0),
        )
        .map_err(|err| format!("failed to check for existing property: {err}"))?;

    if exists > 0 {
        if !allow_existing_update {
            return Err(format!(
                "A property with the address “{}” already exists.",
                listing.address.trim()
            ));
        }

        conn.execute(
            "UPDATE listings SET price = ?1, beds = ?2, baths = ?3, sqft = ?4,
                year_built = ?5, property_type = ?6, description = ?7, status = ?8,
                neighborhood = ?9, days_on_market = ?10
             WHERE lower(trim(address)) = lower(trim(?11))",
            params![
                listing.price,
                listing.beds,
                listing.baths,
                listing.sqft,
                listing.year_built,
                listing.property_type.trim(),
                listing.description.trim(),
                listing.status.trim(),
                listing.neighborhood.trim(),
                listing.days_on_market,
                listing.address.trim()
            ],
        )
        .map_err(|err| format!("failed to update imported property: {err}"))?;
        return Ok(false);
    }

    conn.execute(
        "INSERT INTO listings
            (address, price, beds, baths, sqft, year_built, property_type, description,
             status, neighborhood, days_on_market)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            listing.address.trim(),
            listing.price,
            listing.beds,
            listing.baths,
            listing.sqft,
            listing.year_built,
            listing.property_type.trim(),
            listing.description.trim(),
            listing.status.trim(),
            listing.neighborhood.trim(),
            listing.days_on_market
        ],
    )
    .map_err(|err| format!("failed to create property: {err}"))?;
    Ok(true)
}

fn legacy_db_candidates() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    if let Ok(current_dir) = std::env::current_dir() {
        roots.push(current_dir);
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            roots.push(parent.to_path_buf());
        }
    }

    roots
        .into_iter()
        .flat_map(|root| {
            [
                root.join("data").join("market-cockpit.db"),
                root.join("src-tauri")
                    .join("data")
                    .join("market-cockpit.db"),
            ]
        })
        .collect()
}

fn migrate_legacy_database(target: &Path, candidates: &[PathBuf]) -> Result<(), String> {
    if target.exists() {
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|err| format!("failed to prepare application data directory: {err}"))?;
    }

    for candidate in candidates {
        if !candidate.is_file() || candidate == target {
            continue;
        }

        let source = Connection::open(candidate).map_err(|err| {
            format!("failed to open existing local database for migration: {err}")
        })?;
        source
            .query_row("SELECT COUNT(*) FROM listings", (), |row| {
                row.get::<_, i64>(0)
            })
            .map_err(|err| format!("existing local database could not be verified: {err}"))?;

        let staging = target.with_file_name(format!(
            "market-cockpit-migrating-{}.db",
            std::process::id()
        ));
        let mut destination = Connection::open(&staging)
            .map_err(|err| format!("failed to prepare database migration: {err}"))?;
        Backup::new(&source, &mut destination)
            .and_then(|backup| backup.run_to_completion(32, Duration::from_millis(25), None))
            .map_err(|err| format!("failed to migrate existing local database: {err}"))?;
        drop(destination);
        drop(source);

        if let Err(err) = std::fs::rename(&staging, target) {
            if target.is_file() {
                let _ = std::fs::remove_file(&staging);
            } else {
                return Err(format!(
                    "failed to finalize local database migration: {err}"
                ));
            }
        }
        break;
    }

    Ok(())
}

fn db_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|err| format!("failed to resolve application data directory: {err}"))?;
    std::fs::create_dir_all(&data_dir)
        .map_err(|err| format!("failed to create application data directory: {err}"))?;

    let path = data_dir.join("market-cockpit.db");
    migrate_legacy_database(&path, &legacy_db_candidates())?;
    Ok(path)
}

fn lock_database() -> Result<MutexGuard<'static, ()>, String> {
    DATABASE_OPERATION_LOCK
        .lock()
        .map_err(|_| "the local database operation lock was poisoned".to_string())
}

fn unique_sibling_path(path: &Path, label: &str) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The selected file path has no parent directory.".to_string())?;
    let filename = path
        .file_name()
        .ok_or_else(|| "The selected file path has no file name.".to_string())?
        .to_string_lossy();
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|err| format!("failed to prepare a temporary database path: {err}"))?
        .as_nanos();

    Ok(parent.join(format!(
        ".{filename}.{label}-{}-{timestamp}",
        std::process::id()
    )))
}

fn previous_database_path(path: &Path) -> Result<PathBuf, String> {
    let parent = path
        .parent()
        .ok_or_else(|| "The current database path has no parent directory.".to_string())?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|err| format!("failed to prepare a safety-copy path: {err}"))?
        .as_nanos();

    Ok(parent.join(format!(
        "market-cockpit-before-restore-{}-{timestamp}.db",
        std::process::id()
    )))
}

fn paths_are_same_file(left: &Path, right: &Path) -> Result<bool, String> {
    let left = left
        .canonicalize()
        .map_err(|err| format!("failed to resolve the current database path: {err}"))?;
    let right = if right.exists() {
        right
            .canonicalize()
            .map_err(|err| format!("failed to resolve the selected file path: {err}"))?
    } else {
        let parent = right
            .parent()
            .ok_or_else(|| "The selected file path has no parent directory.".to_string())?;
        parent
            .canonicalize()
            .map_err(|err| format!("failed to resolve the selected folder: {err}"))?
            .join(
                right
                    .file_name()
                    .ok_or_else(|| "The selected file path has no file name.".to_string())?,
            )
    };
    Ok(left == right)
}

fn validate_database_file(path: &Path) -> Result<(), String> {
    if !path.is_file() {
        return Err("The selected backup file does not exist.".to_string());
    }
    let conn = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|err| format!("could not open the selected SQLite database: {err}"))?;
    let integrity: String = conn
        .query_row("PRAGMA integrity_check", [], |row| row.get(0))
        .map_err(|err| format!("could not verify the selected database: {err}"))?;
    if integrity != "ok" {
        return Err(format!(
            "The selected database failed its integrity check: {integrity}"
        ));
    }

    conn.prepare(
        "SELECT address, price, beds, status, neighborhood, days_on_market
         FROM listings LIMIT 0",
    )
    .map_err(|err| format!("The selected database is not a Realty Cockpit database: {err}"))?;
    Ok(())
}

fn copy_database_file(source_path: &Path, destination_path: &Path) -> Result<(), String> {
    let source = Connection::open(source_path)
        .map_err(|err| format!("failed to open the source database: {err}"))?;
    let mut destination = Connection::open(destination_path)
        .map_err(|err| format!("failed to create the database copy: {err}"))?;
    Backup::new(&source, &mut destination)
        .and_then(|backup| backup.run_to_completion(32, Duration::from_millis(25), None))
        .map_err(|err| format!("failed to copy the database: {err}"))?;
    drop(destination);
    drop(source);
    validate_database_file(destination_path)
}

fn replace_database_preserving_previous(
    staged_path: &Path,
    destination_path: &Path,
    previous_path: &Path,
) -> Result<(), String> {
    std::fs::rename(destination_path, previous_path)
        .map_err(|err| format!("failed to preserve the current database: {err}"))?;
    if let Err(install_error) = std::fs::rename(staged_path, destination_path) {
        return match std::fs::rename(previous_path, destination_path) {
            Ok(()) => Err(format!(
                "failed to install the restored database; your current database was put back: {install_error}"
            )),
            Err(rollback_error) => Err(format!(
                "failed to install the restored database ({install_error}); the original database remains at {} because rollback also failed ({rollback_error})",
                previous_path.display()
            )),
        };
    }
    Ok(())
}

fn create_backup_file(source_path: &Path, destination_path: &Path) -> Result<(), String> {
    if paths_are_same_file(source_path, destination_path)? {
        return Err("Choose a different file from the active database.".to_string());
    }
    if destination_path.exists() {
        return Err(
            "A file already exists at that location. Choose a new backup name.".to_string(),
        );
    }
    let parent = destination_path
        .parent()
        .ok_or_else(|| "The selected backup path has no parent directory.".to_string())?;
    if !parent.is_dir() {
        return Err("The selected backup folder no longer exists.".to_string());
    }

    let staged_path = unique_sibling_path(&destination_path, "writing")?;
    let result = copy_database_file(&source_path, &staged_path).and_then(|()| {
        std::fs::rename(&staged_path, &destination_path)
            .map_err(|err| format!("failed to save the backup file: {err}"))
    });
    if result.is_err() && staged_path.exists() {
        if let Err(cleanup_error) = std::fs::remove_file(&staged_path) {
            return Err(format!(
                "{}; failed to remove incomplete backup file: {cleanup_error}",
                result.unwrap_err()
            ));
        }
    }
    result
}

fn restore_database_file(source_path: &Path, destination_path: &Path) -> Result<PathBuf, String> {
    if paths_are_same_file(&destination_path, &source_path)? {
        return Err("Choose a backup file, not the database currently in use.".to_string());
    }
    validate_database_file(&source_path)?;

    let staged_path = unique_sibling_path(&destination_path, "restoring")?;
    let prepare_result = (|| {
        copy_database_file(source_path, &staged_path)?;
        let staged = Connection::open(&staged_path)
            .map_err(|err| format!("failed to prepare the restored database: {err}"))?;
        ensure_column(&staged, "baths", "REAL NOT NULL DEFAULT 0")?;
        ensure_column(&staged, "sqft", "INTEGER NOT NULL DEFAULT 0")?;
        ensure_column(&staged, "year_built", "INTEGER NOT NULL DEFAULT 0")?;
        ensure_column(
            &staged,
            "property_type",
            "TEXT NOT NULL DEFAULT 'Residential'",
        )?;
        ensure_column(&staged, "description", "TEXT NOT NULL DEFAULT ''")?;
        ensure_column(&staged, "notes", "TEXT NOT NULL DEFAULT ''")?;
        drop(staged);
        validate_database_file(&staged_path)?;

        let previous_path = previous_database_path(destination_path)?;
        replace_database_preserving_previous(&staged_path, destination_path, &previous_path)?;
        Ok(previous_path)
    })();

    if prepare_result.is_err() && staged_path.exists() {
        if let Err(cleanup_error) = std::fs::remove_file(&staged_path) {
            return Err(format!(
                "{}; failed to remove incomplete restore file: {cleanup_error}",
                prepare_result.unwrap_err()
            ));
        }
    }
    prepare_result
}

#[tauri::command]
fn backup_database(app_handle: AppHandle, destination: String) -> Result<(), String> {
    let _database_guard = lock_database()?;
    let source_path = db_path(&app_handle)?;
    create_backup_file(&source_path, Path::new(&destination))
}

#[tauri::command]
fn restore_database(app_handle: AppHandle, source: String) -> Result<String, String> {
    let _database_guard = lock_database()?;
    let destination_path = db_path(&app_handle)?;
    restore_database_file(Path::new(&source), &destination_path)
        .map(|previous_path| previous_path.display().to_string())
}

fn ensure_column(conn: &Connection, name: &str, definition: &str) -> Result<(), String> {
    let exists: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('listings') WHERE name = ?1",
            [name],
            |row| row.get(0),
        )
        .map_err(|err| format!("failed to inspect listings schema: {err}"))?;

    if exists == 0 {
        conn.execute(
            &format!("ALTER TABLE listings ADD COLUMN {name} {definition}"),
            (),
        )
        .map_err(|err| format!("failed to add {name} to listings: {err}"))?;
    }

    Ok(())
}

fn open_db(app_handle: &AppHandle) -> Result<Connection, String> {
    let path = db_path(app_handle)?;
    let conn =
        Connection::open(path).map_err(|err| format!("failed to open SQLite database: {err}"))?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS listings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            address TEXT NOT NULL,
            price INTEGER NOT NULL,
            beds INTEGER NOT NULL,
            status TEXT NOT NULL,
            neighborhood TEXT NOT NULL,
            days_on_market INTEGER NOT NULL
        )",
        (),
    )
    .map_err(|err| format!("failed to initialize listings table: {err}"))?;

    ensure_column(&conn, "baths", "REAL NOT NULL DEFAULT 0")?;
    ensure_column(&conn, "sqft", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(&conn, "year_built", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(
        &conn,
        "property_type",
        "TEXT NOT NULL DEFAULT 'Residential'",
    )?;
    ensure_column(&conn, "description", "TEXT NOT NULL DEFAULT ''")?;
    ensure_column(&conn, "notes", "TEXT NOT NULL DEFAULT ''")?;

    conn.execute(
        "UPDATE listings SET
            baths = CASE address
                WHEN '642 Harbor View Ln' THEN 3.0 WHEN '214 Cedar Crest Dr' THEN 2.5
                WHEN '19 Maple Ridge Way' THEN 4.0 WHEN '87 Bayfront Ave' THEN 3.5
                WHEN '118 Lakeview Pl' THEN 2.0 WHEN '315 Orchard Rd' THEN 1.5
                WHEN '54 Sunset Terrace' THEN 3.0 WHEN '9 Quarry Lane' THEN 2.0 ELSE baths END,
            sqft = CASE address
                WHEN '642 Harbor View Ln' THEN 2840 WHEN '214 Cedar Crest Dr' THEN 2160
                WHEN '19 Maple Ridge Way' THEN 3620 WHEN '87 Bayfront Ave' THEN 3180
                WHEN '118 Lakeview Pl' THEN 1940 WHEN '315 Orchard Rd' THEN 1510
                WHEN '54 Sunset Terrace' THEN 2560 WHEN '9 Quarry Lane' THEN 1280 ELSE sqft END,
            year_built = CASE address
                WHEN '642 Harbor View Ln' THEN 2018 WHEN '214 Cedar Crest Dr' THEN 2006
                WHEN '19 Maple Ridge Way' THEN 2021 WHEN '87 Bayfront Ave' THEN 2016
                WHEN '118 Lakeview Pl' THEN 1998 WHEN '315 Orchard Rd' THEN 1979
                WHEN '54 Sunset Terrace' THEN 2012 WHEN '9 Quarry Lane' THEN 2023 ELSE year_built END,
            property_type = CASE address
                WHEN '87 Bayfront Ave' THEN 'Townhouse' WHEN '9 Quarry Lane' THEN 'Condominium'
                ELSE 'Single family' END,
            description = CASE address
                WHEN '642 Harbor View Ln' THEN 'A light-filled coastal home with generous entertaining space, a private garden, and sweeping water views.'
                WHEN '214 Cedar Crest Dr' THEN 'Thoughtfully updated interiors, a calm tree-lined setting, and an easy connection to neighborhood parks.'
                WHEN '19 Maple Ridge Way' THEN 'Contemporary hillside residence with a chef kitchen, flexible guest suite, and broad city outlooks.'
                WHEN '87 Bayfront Ave' THEN 'Refined urban waterfront living with a private roof terrace and a generous two-car garage.'
                WHEN '118 Lakeview Pl' THEN 'A well-kept classic with lake access nearby, a sunroom, and room to make it your own.'
                WHEN '315 Orchard Rd' THEN 'An approachable starter home with a deep backyard and a short walk to local shops.'
                WHEN '54 Sunset Terrace' THEN 'Warm modern finishes, sunset-facing outdoor space, and an easy indoor-outdoor layout.'
                WHEN '9 Quarry Lane' THEN 'A crisp, low-maintenance residence with a private balcony and excellent transit connections.'
                ELSE description END
         WHERE sqft = 0 AND address IN (
            '642 Harbor View Ln', '214 Cedar Crest Dr', '19 Maple Ridge Way', '87 Bayfront Ave',
            '118 Lakeview Pl', '315 Orchard Rd', '54 Sunset Terrace', '9 Quarry Lane'
         )",
        (),
    )
    .map_err(|err| format!("failed to migrate seeded property details: {err}"))?;

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM listings", (), |row| row.get(0))
        .map_err(|err| format!("failed to count listings: {err}"))?;

    if count == 0 {
        conn.execute(
            "INSERT INTO listings
                (address, price, beds, baths, sqft, year_built, property_type, description, status, neighborhood, days_on_market)
             VALUES
                ('642 Harbor View Ln', 1240000, 4, 3.0, 2840, 2018, 'Single family', 'A light-filled coastal home with generous entertaining space, a private garden, and sweeping water views.', 'Active', 'North Shore', 24),
                ('214 Cedar Crest Dr', 980000, 3, 2.5, 2160, 2006, 'Single family', 'Thoughtfully updated interiors, a calm tree-lined setting, and an easy connection to neighborhood parks.', 'New', 'Brookside', 8),
                ('19 Maple Ridge Way', 1780000, 5, 4.0, 3620, 2021, 'Single family', 'Contemporary hillside residence with a chef''s kitchen, flexible guest suite, and broad city outlooks.', 'Price Reduced', 'Hillside', 41),
                ('87 Bayfront Ave', 1520000, 4, 3.5, 3180, 2016, 'Townhouse', 'Refined urban waterfront living with a private roof terrace and a generous two-car garage.', 'Under Offer', 'West End', 16),
                ('118 Lakeview Pl', 875000, 3, 2.0, 1940, 1998, 'Single family', 'A well-kept classic with lake access nearby, a sunroom, and room to make it your own.', 'Active', 'North Shore', 12),
                ('315 Orchard Rd', 640000, 3, 1.5, 1510, 1979, 'Single family', 'An approachable starter home with a deep backyard and a short walk to local shops.', 'Active', 'West End', 7),
                ('54 Sunset Terrace', 1150000, 4, 3.0, 2560, 2012, 'Single family', 'Warm modern finishes, sunset-facing outdoor space, and an easy indoor-outdoor layout.', 'Price Reduced', 'Hillside', 31),
                ('9 Quarry Lane', 795000, 2, 2.0, 1280, 2023, 'Condominium', 'A crisp, low-maintenance residence with a private balcony and excellent transit connections.', 'New', 'Brookside', 5)",
            (),
        )
        .map_err(|err| format!("failed to seed listing records: {err}"))?;
    }

    Ok(conn)
}

#[tauri::command]
fn get_dashboard_data(app_handle: AppHandle) -> Result<DashboardData, String> {
    let _database_guard = lock_database()?;
    let conn = open_db(&app_handle)?;

    let listings = conn
        .prepare(
            "SELECT address, price, beds, baths, sqft, year_built, property_type, description, notes,
                    status, neighborhood, days_on_market
             FROM listings
             ORDER BY price DESC",
        )
        .map_err(|err| format!("failed to query listings: {err}"))?
        .query_map([], |row| {
            Ok(Listing {
                address: row.get("address")?,
                price: format!("${}", row.get::<_, i64>("price")?),
                beds: row.get("beds")?,
                baths: row.get("baths")?,
                sqft: row.get("sqft")?,
                year_built: row.get("year_built")?,
                property_type: row.get("property_type")?,
                description: row.get("description")?,
                notes: row.get("notes")?,
                status: row.get("status")?,
                neighborhood: row.get("neighborhood")?,
                days_on_market: row.get("days_on_market")?,
            })
        })
        .map_err(|err| format!("failed to map listings: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("failed to collect listings: {err}"))?;

    let neighborhood_counts = conn
        .prepare("SELECT neighborhood, COUNT(*) FROM listings GROUP BY neighborhood")
        .map_err(|err| format!("failed to query neighborhood inventory: {err}"))?
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i32>(1)?))
        })
        .map_err(|err| format!("failed to map neighborhood inventory: {err}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| format!("failed to collect neighborhood inventory: {err}"))?;

    let neighborhood_metrics = [
        ("North Shore", "$1.08M", "+6.4%"),
        ("Brookside", "$890K", "+4.9%"),
        ("Hillside", "$1.46M", "+7.2%"),
        ("West End", "$1.26M", "+8.1%"),
    ];
    let neighborhoods = neighborhood_counts
        .iter()
        .map(|(name, count)| {
            let metrics = neighborhood_metrics
                .iter()
                .find(|(known_name, _, _)| *known_name == name);
            Neighborhood {
                name: name.clone(),
                median: metrics
                    .map_or_else(|| "—".to_string(), |(_, median, _)| median.to_string()),
                yoy: metrics.map_or_else(|| "—".to_string(), |(_, _, yoy)| yoy.to_string()),
                active_listings: *count,
            }
        })
        .collect();

    let stats = vec![
        Stat {
            label: "Active listings".to_string(),
            value: listings.len().to_string(),
            trend: "+12.4%".to_string(),
        },
        Stat {
            label: "Average days on market".to_string(),
            value: "21".to_string(),
            trend: "-3 days".to_string(),
        },
        Stat {
            label: "Median sold price".to_string(),
            value: "$1.08M".to_string(),
            trend: "+6.8%".to_string(),
        },
        Stat {
            label: "Buyers in pipeline".to_string(),
            value: "47".to_string(),
            trend: "+9".to_string(),
        },
    ];

    let searches = vec![
        "Buyer: 3–4 bed, $700k–$1.1M, walkable schools".to_string(),
        "Investor: 2 unit, 5–7% cap rate, near transit".to_string(),
        "Luxury: 4+ bed, waterfront, under $2M".to_string(),
    ];

    Ok(DashboardData {
        stats,
        listings,
        neighborhoods,
        searches,
    })
}

#[tauri::command]
fn save_listing_notes(app_handle: AppHandle, address: String, notes: String) -> Result<(), String> {
    let _database_guard = lock_database()?;
    if notes.chars().count() > 5_000 {
        return Err("Notes must be 5,000 characters or fewer.".to_string());
    }

    let conn = open_db(&app_handle)?;
    let updated = conn
        .execute(
            "UPDATE listings SET notes = ?1 WHERE address = ?2",
            params![notes, address],
        )
        .map_err(|err| format!("failed to save listing notes: {err}"))?;

    if updated == 0 {
        return Err("The selected listing could not be found.".to_string());
    }

    Ok(())
}

#[tauri::command]
fn save_listing(
    app_handle: AppHandle,
    input: ListingInput,
    original_address: Option<String>,
) -> Result<(), String> {
    let _database_guard = lock_database()?;
    validate_listing(&input)?;
    let conn = open_db(&app_handle)?;
    write_listing(&conn, &input, original_address.as_deref(), false)?;
    Ok(())
}

#[tauri::command]
fn import_listings(
    app_handle: AppHandle,
    listings: Vec<ListingInput>,
) -> Result<ImportResult, String> {
    let _database_guard = lock_database()?;
    if listings.is_empty() {
        return Err("The CSV file does not contain any property rows.".to_string());
    }
    if listings.len() > 5_000 {
        return Err("A single import is limited to 5,000 properties.".to_string());
    }
    for (index, listing) in listings.iter().enumerate() {
        validate_listing(listing).map_err(|error| format!("Row {}: {error}", index + 2))?;
    }

    let mut conn = open_db(&app_handle)?;
    let transaction = conn
        .transaction()
        .map_err(|err| format!("failed to start property import: {err}"))?;
    let mut result = ImportResult {
        created: 0,
        updated: 0,
    };

    for listing in &listings {
        if write_listing(&transaction, listing, None, true)? {
            result.created += 1;
        } else {
            result.updated += 1;
        }
    }

    transaction
        .commit()
        .map_err(|err| format!("failed to commit property import: {err}"))?;
    Ok(result)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_dashboard_data,
            save_listing_notes,
            save_listing,
            import_listings,
            backup_database,
            restore_database
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE listings (
                address TEXT NOT NULL,
                price INTEGER NOT NULL,
                beds INTEGER NOT NULL,
                baths REAL NOT NULL,
                sqft INTEGER NOT NULL,
                year_built INTEGER NOT NULL,
                property_type TEXT NOT NULL,
                description TEXT NOT NULL,
                status TEXT NOT NULL,
                neighborhood TEXT NOT NULL,
                days_on_market INTEGER NOT NULL,
                notes TEXT NOT NULL DEFAULT ''
            )",
        )
        .unwrap();
        conn
    }

    fn sample_listing(address: &str, price: i64) -> ListingInput {
        ListingInput {
            address: address.to_string(),
            price,
            beds: 3,
            baths: 2.0,
            sqft: 1600,
            year_built: 2005,
            property_type: "Single family".to_string(),
            description: "Test property".to_string(),
            status: "Active".to_string(),
            neighborhood: "North Shore".to_string(),
            days_on_market: 10,
        }
    }

    #[test]
    fn csv_upsert_updates_property_and_preserves_private_notes() {
        let conn = setup_db();
        let first = sample_listing("123 Example Street", 850_000);
        assert!(write_listing(&conn, &first, None, true).unwrap());
        conn.execute("UPDATE listings SET notes = 'Private viewing note'", ())
            .unwrap();

        let update = sample_listing("123 example street", 875_000);
        assert!(!write_listing(&conn, &update, None, true).unwrap());

        let row: (String, i64, String) = conn
            .query_row("SELECT address, price, notes FROM listings", (), |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .unwrap();
        assert_eq!(
            row,
            (
                "123 Example Street".to_string(),
                875_000,
                "Private viewing note".to_string()
            )
        );
    }

    #[test]
    fn manual_create_rejects_case_insensitive_duplicate_address() {
        let conn = setup_db();
        let first = sample_listing("123 Example Street", 850_000);
        write_listing(&conn, &first, None, false).unwrap();

        let duplicate = sample_listing(" 123 example street ", 900_000);
        let error = write_listing(&conn, &duplicate, None, false).unwrap_err();
        assert!(error.contains("already exists"));
    }

    #[test]
    fn listing_validation_rejects_non_positive_price() {
        let listing = sample_listing("123 Example Street", 0);
        assert!(validate_listing(&listing).is_err());
    }

    #[test]
    fn legacy_database_migrates_all_rows_and_notes() {
        let test_dir = std::env::temp_dir().join(format!(
            "realty-cockpit-migration-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&test_dir).unwrap();
        let legacy = test_dir
            .join("legacy")
            .join("data")
            .join("market-cockpit.db");
        let target = test_dir.join("app-data").join("market-cockpit.db");
        std::fs::create_dir_all(legacy.parent().unwrap()).unwrap();

        {
            let conn = Connection::open(&legacy).unwrap();
            conn.execute_batch(
                "CREATE TABLE listings (
                    address TEXT NOT NULL, price INTEGER NOT NULL, beds INTEGER NOT NULL,
                    baths REAL NOT NULL, sqft INTEGER NOT NULL, year_built INTEGER NOT NULL,
                    property_type TEXT NOT NULL, description TEXT NOT NULL, status TEXT NOT NULL,
                    neighborhood TEXT NOT NULL, days_on_market INTEGER NOT NULL,
                    notes TEXT NOT NULL
                );
                INSERT INTO listings VALUES (
                    '123 Example Street', 850000, 3, 2, 1600, 2005, 'Single family',
                    'Legacy home', 'Active', 'North Shore', 10, 'Keep this note'
                );",
            )
            .unwrap();
        }

        migrate_legacy_database(&target, std::slice::from_ref(&legacy)).unwrap();

        let migrated = Connection::open(&target).unwrap();
        let row: (String, i64, String) = migrated
            .query_row("SELECT address, price, notes FROM listings", (), |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .unwrap();
        assert_eq!(
            row,
            (
                "123 Example Street".to_string(),
                850_000,
                "Keep this note".to_string()
            )
        );

        drop(migrated);
        std::fs::remove_dir_all(test_dir).unwrap();
    }

    #[test]
    fn backup_restore_preserves_listings_and_notes_and_keeps_previous_database() {
        let test_dir = std::env::temp_dir().join(format!(
            "realty-cockpit-backup-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&test_dir).unwrap();
        let active_path = test_dir.join("market-cockpit.db");
        let backup_path = test_dir.join("portable-backup.db");

        let original = setup_db();
        let first = sample_listing("123 Example Street", 850_000);
        write_listing(&original, &first, None, true).unwrap();
        original
            .execute("UPDATE listings SET notes = 'Private viewing note'", [])
            .unwrap();
        let mut active_file = Connection::open(&active_path).unwrap();
        Backup::new(&original, &mut active_file)
            .unwrap()
            .run_to_completion(32, Duration::from_millis(1), None)
            .unwrap();
        drop(active_file);
        drop(original);

        create_backup_file(&active_path, &backup_path).unwrap();
        {
            let current = Connection::open(&active_path).unwrap();
            current
                .execute("UPDATE listings SET notes = 'Newer private note'", [])
                .unwrap();
            write_listing(
                &current,
                &sample_listing("456 Later Street", 920_000),
                None,
                true,
            )
            .unwrap();
        }

        let previous_path = restore_database_file(&backup_path, &active_path).unwrap();
        assert_eq!(
            previous_path.extension().and_then(|ext| ext.to_str()),
            Some("db")
        );
        let restored = Connection::open(&active_path).unwrap();
        let restored_count: i64 = restored
            .query_row("SELECT COUNT(*) FROM listings", [], |row| row.get(0))
            .unwrap();
        let restored_note: String = restored
            .query_row(
                "SELECT notes FROM listings WHERE address = '123 Example Street'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(restored_count, 1);
        assert_eq!(restored_note, "Private viewing note");

        let previous = Connection::open(&previous_path).unwrap();
        let previous_count: i64 = previous
            .query_row("SELECT COUNT(*) FROM listings", [], |row| row.get(0))
            .unwrap();
        let previous_note: String = previous
            .query_row(
                "SELECT notes FROM listings WHERE address = '123 Example Street'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(previous_count, 2);
        assert_eq!(previous_note, "Newer private note");

        drop(previous);
        drop(restored);
        std::fs::remove_dir_all(test_dir).unwrap();
    }

    #[test]
    fn restore_rejects_non_cockpit_database_without_changing_current_data() {
        let test_dir = std::env::temp_dir().join(format!(
            "realty-cockpit-invalid-restore-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&test_dir).unwrap();
        let active_path = test_dir.join("market-cockpit.db");
        let invalid_path = test_dir.join("not-a-cockpit-backup.db");
        let active = setup_db();
        write_listing(
            &active,
            &sample_listing("123 Example Street", 850_000),
            None,
            true,
        )
        .unwrap();
        let mut active_file = Connection::open(&active_path).unwrap();
        Backup::new(&active, &mut active_file)
            .unwrap()
            .run_to_completion(32, Duration::from_millis(1), None)
            .unwrap();
        drop(active_file);
        drop(active);
        Connection::open(&invalid_path)
            .unwrap()
            .execute_batch("CREATE TABLE unrelated (value TEXT);")
            .unwrap();

        assert!(restore_database_file(&invalid_path, &active_path).is_err());
        let unchanged = Connection::open(&active_path).unwrap();
        let address: String = unchanged
            .query_row("SELECT address FROM listings", [], |row| row.get(0))
            .unwrap();
        assert_eq!(address, "123 Example Street");

        drop(unchanged);
        std::fs::remove_dir_all(test_dir).unwrap();
    }
}
