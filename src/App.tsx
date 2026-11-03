import { useEffect, useMemo, useState, type FormEvent } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { check, type Update } from "@tauri-apps/plugin-updater";
import "./App.css";

type Stat = {
  label: string;
  value: string;
  trend: string;
};

type Listing = {
  address: string;
  price: string;
  beds: number;
  baths: number;
  sqft: number;
  year_built: number;
  property_type: string;
  description: string;
  notes: string;
  status: string;
  neighborhood: string;
  days_on_market: number;
};

type ListingInput = {
  address: string;
  price: number;
  beds: number;
  baths: number;
  sqft: number;
  yearBuilt: number;
  propertyType: string;
  description: string;
  status: string;
  neighborhood: string;
  daysOnMarket: number;
};

type ImportResult = {
  created: number;
  updated: number;
};

type Neighborhood = {
  name: string;
  median: string;
  yoy: string;
  active_listings: number;
};

type DashboardData = {
  stats: Stat[];
  listings: Listing[];
  neighborhoods: Neighborhood[];
  searches: string[];
};

type View = "dashboard" | "listings" | "map" | "market" | "saved" | "property";

const previewData: DashboardData = {
  stats: [
    { label: "Active listings", value: "8", trend: "+12.4%" },
    { label: "Average days on market", value: "21", trend: "-3 days" },
    { label: "Median sold price", value: "$1.08M", trend: "+6.8%" },
    { label: "Buyers in pipeline", value: "47", trend: "+9" },
  ],
  listings: [
    { address: "642 Harbor View Ln", price: "$1,240,000", beds: 4, baths: 3, sqft: 2840, year_built: 2018, property_type: "Single family", description: "A light-filled coastal home with generous entertaining space, a private garden, and sweeping water views.", notes: "", status: "Active", neighborhood: "North Shore", days_on_market: 24 },
    { address: "214 Cedar Crest Dr", price: "$980,000", beds: 3, baths: 2.5, sqft: 2160, year_built: 2006, property_type: "Single family", description: "Thoughtfully updated interiors, a calm tree-lined setting, and an easy connection to neighborhood parks.", notes: "", status: "New", neighborhood: "Brookside", days_on_market: 8 },
    { address: "19 Maple Ridge Way", price: "$1,780,000", beds: 5, baths: 4, sqft: 3620, year_built: 2021, property_type: "Single family", description: "Contemporary hillside residence with a chef's kitchen, flexible guest suite, and broad city outlooks.", notes: "", status: "Price Reduced", neighborhood: "Hillside", days_on_market: 41 },
    { address: "87 Bayfront Ave", price: "$1,520,000", beds: 4, baths: 3.5, sqft: 3180, year_built: 2016, property_type: "Townhouse", description: "Refined urban waterfront living with a private roof terrace and a generous two-car garage.", notes: "", status: "Under Offer", neighborhood: "West End", days_on_market: 16 },
    { address: "118 Lakeview Pl", price: "$875,000", beds: 3, baths: 2, sqft: 1940, year_built: 1998, property_type: "Single family", description: "A well-kept classic with lake access nearby, a sunroom, and room to make it your own.", notes: "", status: "Active", neighborhood: "North Shore", days_on_market: 12 },
    { address: "315 Orchard Rd", price: "$640,000", beds: 3, baths: 1.5, sqft: 1510, year_built: 1979, property_type: "Single family", description: "An approachable starter home with a deep backyard and a short walk to local shops.", notes: "", status: "Active", neighborhood: "West End", days_on_market: 7 },
    { address: "54 Sunset Terrace", price: "$1,150,000", beds: 4, baths: 3, sqft: 2560, year_built: 2012, property_type: "Single family", description: "Warm modern finishes, sunset-facing outdoor space, and an easy indoor-outdoor layout.", notes: "", status: "Price Reduced", neighborhood: "Hillside", days_on_market: 31 },
    { address: "9 Quarry Lane", price: "$795,000", beds: 2, baths: 2, sqft: 1280, year_built: 2023, property_type: "Condominium", description: "A crisp, low-maintenance residence with a private balcony and excellent transit connections.", notes: "", status: "New", neighborhood: "Brookside", days_on_market: 5 },
  ],
  neighborhoods: [
    { name: "North Shore", median: "$1.08M", yoy: "+6.4%", active_listings: 2 },
    { name: "Brookside", median: "$890K", yoy: "+4.9%", active_listings: 2 },
    { name: "Hillside", median: "$1.46M", yoy: "+7.2%", active_listings: 2 },
    { name: "West End", median: "$1.26M", yoy: "+8.1%", active_listings: 2 },
  ],
  searches: [
    "Buyer: 3–4 bed, $700k–$1.1M, walkable schools",
    "Investor: 2 unit, 5–7% cap rate, near transit",
    "Luxury: 4+ bed, waterfront, under $2M",
  ],
};

const navItems: { id: View; label: string }[] = [
  { id: "dashboard", label: "Overview" },
  { id: "listings", label: "Properties" },
  { id: "map", label: "Neighborhoods" },
  { id: "market", label: "Market" },
  { id: "saved", label: "Saved" },
];

const neighborhoodCoordinates: Record<string, { left: string; top: string }> = {
  "North Shore": { left: "70%", top: "23%" },
  Brookside: { left: "43%", top: "53%" },
  Hillside: { left: "19%", top: "32%" },
  "West End": { left: "69%", top: "72%" },
};

function statusClass(status: string) {
  return status.toLowerCase().replace(/\s+/g, "-");
}

function matchesSavedSearch(listing: Listing, searchIndex: number) {
  const price = Number(listing.price.replace(/[^\d]/g, ""));

  if (searchIndex === 0) {
    return listing.beds >= 3 && listing.beds <= 4 && price >= 700_000 && price <= 1_100_000;
  }
  if (searchIndex === 1) {
    return listing.property_type.toLowerCase().includes("multi-unit");
  }
  if (searchIndex === 2) {
    const isWaterfront = /water|bayfront/i.test(`${listing.address} ${listing.description}`);
    return listing.beds >= 4 && price < 2_000_000 && isWaterfront;
  }
  return true;
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error("The CSV contains an unclosed quoted field.");
  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) rows.push(row);
  return rows;
}

function parseListingCsv(text: string): ListingInput[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error("Choose a CSV with a header row and at least one property.");

  const normalizeHeader = (header: string) =>
    header.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  const headers = rows[0].map(normalizeHeader);
  const aliases: Record<string, string[]> = {
    address: ["address", "property", "street address"],
    price: ["price", "asking price", "list price"],
    beds: ["beds", "bed", "bedrooms"],
    baths: ["baths", "bath", "bathrooms"],
    sqft: ["sqft", "square feet", "interior sqft", "living area"],
    yearBuilt: ["year built", "year"],
    propertyType: ["property type", "type"],
    description: ["description", "remarks"],
    status: ["status", "listing status"],
    neighborhood: ["neighborhood", "district", "area"],
    daysOnMarket: ["days on market", "dom"],
  };
  const indexes = Object.fromEntries(
    Object.entries(aliases).map(([field, names]) => [
      field,
      headers.findIndex((header) => names.includes(header)),
    ]),
  ) as Record<keyof ListingInput, number>;
  const required: (keyof ListingInput)[] = ["address", "price", "beds", "neighborhood"];
  const missing = required.filter((field) => indexes[field] < 0);
  if (missing.length) {
    throw new Error(`Missing required CSV columns: ${missing.join(", ")}.`);
  }

  const read = (cells: string[], field: keyof ListingInput) =>
    indexes[field] < 0 ? "" : (cells[indexes[field]] ?? "").trim();
  const parseNumeric = (
    value: string,
    field: string,
    rowNumber: number,
    options: { defaultValue?: number; allowSuffix?: boolean } = {},
  ) => {
    if (!value) {
      if (options.defaultValue !== undefined) return options.defaultValue;
      throw new Error(`Row ${rowNumber}: ${field} is required.`);
    }
    const normalized = value.replace(/[$,\s]/g, "").replace(/^USD/i, "");
    const match = normalized.match(/^(\d+(?:\.\d+)?)([kKmM])?$/);
    if (!match) throw new Error(`Row ${rowNumber}: “${value}” is not a valid ${field}.`);
    const multiplier = options.allowSuffix
      ? match[2]?.toLowerCase() === "m" ? 1_000_000 : match[2]?.toLowerCase() === "k" ? 1_000 : 1
      : match[2] ? NaN : 1;
    const parsed = Number(match[1]) * multiplier;
    if (!Number.isFinite(parsed)) {
      throw new Error(`Row ${rowNumber}: suffixes are only supported for price values.`);
    }
    return parsed;
  };

  return rows.slice(1).map((cells, index) => {
    const rowNumber = index + 2;
    const address = read(cells, "address");
    const neighborhood = read(cells, "neighborhood");
    if (!address) throw new Error(`Row ${rowNumber}: address is required.`);
    if (!neighborhood) throw new Error(`Row ${rowNumber}: neighborhood is required.`);

    return {
      address,
      price: Math.round(parseNumeric(read(cells, "price"), "price", rowNumber, { allowSuffix: true })),
      beds: parseNumeric(read(cells, "beds"), "beds", rowNumber),
      baths: parseNumeric(read(cells, "baths"), "baths", rowNumber, { defaultValue: 0 }),
      sqft: parseNumeric(read(cells, "sqft"), "square footage", rowNumber, { defaultValue: 0 }),
      yearBuilt: parseNumeric(read(cells, "yearBuilt"), "year built", rowNumber, { defaultValue: 0 }),
      propertyType: read(cells, "propertyType") || "Residential",
      description: read(cells, "description"),
      status: read(cells, "status") || "Active",
      neighborhood,
      daysOnMarket: parseNumeric(read(cells, "daysOnMarket"), "days on market", rowNumber, { defaultValue: 0 }),
    };
  });
}

function toListing(input: ListingInput, notes = ""): Listing {
  return {
    address: input.address,
    price: `$${input.price.toLocaleString("en-US")}`,
    beds: input.beds,
    baths: input.baths,
    sqft: input.sqft,
    year_built: input.yearBuilt,
    property_type: input.propertyType,
    description: input.description,
    notes,
    status: input.status,
    neighborhood: input.neighborhood,
    days_on_market: input.daysOnMarket,
  };
}

function refreshDashboardListings(dashboard: DashboardData, listings: Listing[]): DashboardData {
  const counts = new Map<string, number>();
  for (const listing of listings) {
    counts.set(listing.neighborhood, (counts.get(listing.neighborhood) ?? 0) + 1);
  }
  const knownNeighborhoods = new Map(
    dashboard.neighborhoods.map((area) => [area.name, area]),
  );
  const neighborhoods = [...counts.entries()]
    .map(([name, count]) => {
      const existing = knownNeighborhoods.get(name);
      return existing
        ? { ...existing, active_listings: count }
        : { name, median: "—", yoy: "—", active_listings: count };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    ...dashboard,
    listings,
    neighborhoods,
    stats: dashboard.stats.map((stat) =>
      stat.label === "Active listings" ? { ...stat, value: listings.length.toString() } : stat,
    ),
  };
}

function mergeImportedListings(existing: Listing[], inputs: ListingInput[]): Listing[] {
  const result = [...existing];
  for (const input of inputs) {
    const index = result.findIndex(
      (listing) => listing.address.trim().toLowerCase() === input.address.trim().toLowerCase(),
    );
    if (index >= 0) {
      result[index] = toListing(input, result[index].notes);
    } else {
      result.push(toListing(input));
    }
  }
  return result.sort(
    (left, right) => Number(right.price.replace(/[^\d]/g, "")) - Number(left.price.replace(/[^\d]/g, "")),
  );
}

function downloadCsvTemplate() {
  const template = [
    "address,price,beds,baths,sqft,year_built,property_type,description,status,neighborhood,days_on_market",
    '"123 Example Street",850000,3,2,1600,2005,Single family,"Light-filled home with a private garden",Active,North Shore,12',
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([template], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "realty-cockpit-import-template.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}

function App() {
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [selectedNeighborhood, setSelectedNeighborhood] = useState<string | null>(null);
  const [savedSearchFilter, setSavedSearchFilter] = useState<number | null>(null);
  const [view, setView] = useState<View>("dashboard");
  const [notesDraft, setNotesDraft] = useState("");
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesMessage, setNotesMessage] = useState<string | null>(null);
  const [notesError, setNotesError] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorListing, setEditorListing] = useState<Listing | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<ListingInput[] | null>(null);
  const [importFileName, setImportFileName] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupNotice, setBackupNotice] = useState<string | null>(null);
  const [restoreCandidate, setRestoreCandidate] = useState<string | null>(null);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);
  const [updateDownloaded, setUpdateDownloaded] = useState(0);
  const [updateSize, setUpdateSize] = useState<number | null>(null);

  useEffect(() => {
    let active = true;

    const loadDashboard = async () => {
      try {
        const data = isTauri()
          ? await invoke<DashboardData>("get_dashboard_data")
          : previewData;
        if (!active) return;
        setDashboard(data);
        setSelectedAddress(data.listings[0]?.address ?? null);
      } catch (error) {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        if (active) setLoading(false);
      }
    };

    void loadDashboard();
    return () => {
      active = false;
    };
  }, []);

  const visibleListings = useMemo(() => {
    if (!dashboard) return [];
    const normalizedQuery = query.trim().toLowerCase();

    return dashboard.listings.filter((listing) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        listing.address.toLowerCase().includes(normalizedQuery) ||
        listing.neighborhood.toLowerCase().includes(normalizedQuery);
      const matchesStatus = statusFilter === "All" || listing.status === statusFilter;
      const matchesNeighborhood =
        !selectedNeighborhood || listing.neighborhood === selectedNeighborhood;
      const matchesSaved =
        savedSearchFilter === null || matchesSavedSearch(listing, savedSearchFilter);
      return matchesQuery && matchesStatus && matchesNeighborhood && matchesSaved;
    });
  }, [dashboard, query, savedSearchFilter, selectedNeighborhood, statusFilter]);

  const selectedListing =
    visibleListings.find((listing) => listing.address === selectedAddress) ??
    visibleListings[0] ??
    null;

  useEffect(() => {
    if (!visibleListings.length) {
      setSelectedAddress(null);
      return;
    }

    if (!selectedAddress || !visibleListings.some((listing) => listing.address === selectedAddress)) {
      setSelectedAddress(visibleListings[0].address);
    }
  }, [selectedAddress, visibleListings]);

  useEffect(() => {
    setNotesDraft(selectedListing?.notes ?? "");
    setNotesMessage(null);
    setNotesError(null);
  }, [selectedListing?.address]);

  const saveNotes = async () => {
    if (!selectedListing) return;
    setNotesSaving(true);
    setNotesMessage(null);
    setNotesError(null);

    try {
      if (isTauri()) {
        await invoke("save_listing_notes", {
          address: selectedListing.address,
          notes: notesDraft,
        });
      }
      setDashboard((current) =>
        current
          ? {
              ...current,
              listings: current.listings.map((listing) =>
                listing.address === selectedListing.address
                  ? { ...listing, notes: notesDraft }
                  : listing,
              ),
            }
          : current,
      );
      setNotesMessage(isTauri() ? "Notes saved to this device." : "Notes saved for this preview session.");
    } catch (error) {
      setNotesError(error instanceof Error ? error.message : String(error));
    } finally {
      setNotesSaving(false);
    }
  };

  const openListingEditor = (listing: Listing | null = null) => {
    setEditorListing(listing);
    setEditorOpen(true);
  };

  const saveListing = async (input: ListingInput) => {
    const originalAddress = editorListing?.address ?? null;
    if (isTauri()) {
      await invoke("save_listing", { input, originalAddress });
    }

    if (isTauri()) {
      const data = await invoke<DashboardData>("get_dashboard_data");
      setDashboard(data);
    } else {
      setDashboard((current) => {
        if (!current) return current;
        const nextListings = mergeImportedListings(
          current.listings.filter((listing) => listing.address !== originalAddress),
          [input],
        );
        const previous = current.listings.find((listing) => listing.address === originalAddress);
        if (previous?.notes) {
          const updated = nextListings.find((listing) => listing.address === input.address);
          if (updated) updated.notes = previous.notes;
        }
        return refreshDashboardListings(current, nextListings);
      });
    }

    setSelectedAddress(input.address);
    setView("property");
    setEditorOpen(false);
    setEditorListing(null);
  };

  const selectCsvFile = async (file: File | undefined) => {
    setPendingImport(null);
    setImportError(null);
    setImportSuccess(null);
    setImportFileName("");
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportError("Choose a .csv file to import.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setImportError("CSV files must be 10 MB or smaller.");
      return;
    }

    try {
      const entries = parseListingCsv(await file.text());
      if (entries.length > 5_000) {
        throw new Error("A single import is limited to 5,000 properties.");
      }
      const seen = new Set<string>();
      for (const [index, entry] of entries.entries()) {
        const key = entry.address.trim().toLowerCase();
        if (seen.has(key)) {
          throw new Error(`Rows contain the same address more than once: “${entry.address}” (row ${index + 2}).`);
        }
        seen.add(key);
        if (!Number.isSafeInteger(entry.price) || entry.price <= 0) {
          throw new Error(`Row ${index + 2}: price must be greater than zero.`);
        }
        if (
          !Number.isInteger(entry.beds) ||
          entry.beds < 0 ||
          entry.beds > 50 ||
          !Number.isFinite(entry.baths) ||
          entry.baths < 0 ||
          entry.baths > 50 ||
          !Number.isInteger(entry.sqft) ||
          entry.sqft < 0 ||
          entry.sqft > 2_000_000
        ) {
          throw new Error(`Row ${index + 2}: beds, baths, and square footage must be within the supported ranges.`);
        }
        if (
          !Number.isInteger(entry.yearBuilt) ||
          entry.yearBuilt < 0 ||
          entry.yearBuilt > 2200 ||
          !Number.isInteger(entry.daysOnMarket) ||
          entry.daysOnMarket < 0 ||
          entry.daysOnMarket > 10000
        ) {
          throw new Error(`Row ${index + 2}: year built and days on market must be within the supported ranges.`);
        }
        if (
          entry.address.length > 300 ||
          !entry.neighborhood.trim() ||
          entry.neighborhood.length > 120 ||
          !entry.propertyType.trim() ||
          entry.propertyType.length > 100 ||
          entry.description.length > 5000
        ) {
          throw new Error(`Row ${index + 2}: address, neighborhood, property type, or description is invalid.`);
        }
      }
      setPendingImport(entries);
      setImportFileName(file.name);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    }
  };

  const importCsv = async () => {
    if (!pendingImport || !dashboard) return;
    setImporting(true);
    setImportError(null);
    try {
      let result: ImportResult;
      if (isTauri()) {
        result = await invoke<ImportResult>("import_listings", { listings: pendingImport });
        setDashboard(await invoke<DashboardData>("get_dashboard_data"));
      } else {
        const priorAddresses = new Set(
          dashboard.listings.map((listing) => listing.address.trim().toLowerCase()),
        );
        result = {
          created: pendingImport.filter(
            (listing) => !priorAddresses.has(listing.address.trim().toLowerCase()),
          ).length,
          updated: pendingImport.length - pendingImport.filter(
            (listing) => !priorAddresses.has(listing.address.trim().toLowerCase()),
          ).length,
        };
        setDashboard(
          refreshDashboardListings(
            dashboard,
            mergeImportedListings(dashboard.listings, pendingImport),
          ),
        );
      }
      setSelectedAddress(pendingImport[0].address);
      setImportSuccess(`${result.created} added · ${result.updated} updated`);
      setPendingImport(null);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  };

  const createBackup = async () => {
    setBackupBusy(true);
    setBackupError(null);
    setBackupNotice(null);
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const destination = await save({
        title: "Save Realty Cockpit backup",
        defaultPath: `Realty-Cockpit-backup-${timestamp}.db`,
        filters: [{ name: "SQLite database", extensions: ["db"] }],
      });
      if (!destination) return;
      await invoke("backup_database", { destination });
      setBackupNotice(`Backup created: ${destination}`);
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error));
    } finally {
      setBackupBusy(false);
    }
  };

  const chooseRestoreFile = async () => {
    setBackupBusy(true);
    setBackupError(null);
    setBackupNotice(null);
    try {
      const source = await open({
        title: "Choose a Realty Cockpit backup",
        multiple: false,
        directory: false,
        filters: [{ name: "SQLite database", extensions: ["db"] }],
      });
      if (typeof source === "string") setRestoreCandidate(source);
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error));
    } finally {
      setBackupBusy(false);
    }
  };

  const restoreBackup = async () => {
    if (!restoreCandidate) return;
    setBackupBusy(true);
    setBackupError(null);
    setBackupNotice(null);
    try {
      const previousDatabase = await invoke<string>("restore_database", {
        source: restoreCandidate,
      });
      setRestoreCandidate(null);
      try {
        const restoredDashboard = await invoke<DashboardData>("get_dashboard_data");
        setDashboard(restoredDashboard);
        setSelectedAddress(restoredDashboard.listings[0]?.address ?? null);
        setNotesDraft(restoredDashboard.listings[0]?.notes ?? "");
        setNotesMessage(null);
        setNotesError(null);
        setSelectedNeighborhood(null);
        setSavedSearchFilter(null);
        setBackupNotice(`Restore complete. Your previous database is preserved at: ${previousDatabase}`);
      } catch (error) {
        setBackupNotice(
          `Restore completed and your previous database is preserved at ${previousDatabase}. Restart the app to reload the restored data. Refresh error: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : String(error));
    } finally {
      setBackupBusy(false);
    }
  };

  const checkForUpdates = async () => {
    setUpdateDialogOpen(true);
    setUpdateChecking(true);
    setUpdateError(null);
    setUpdateNotice(null);
    setUpdateDownloaded(0);
    setUpdateSize(null);
    try {
      if (availableUpdate) {
        await availableUpdate.close();
        setAvailableUpdate(null);
      }
      const update = await check();
      setAvailableUpdate(update);
      setUpdateNotice(update ? null : "Realty Cockpit is up to date.");
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : String(error));
    } finally {
      setUpdateChecking(false);
    }
  };

  const installAvailableUpdate = async () => {
    if (!availableUpdate) return;
    setUpdateInstalling(true);
    setUpdateError(null);
    setUpdateNotice(null);
    setUpdateDownloaded(0);
    setUpdateSize(null);
    try {
      await availableUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setUpdateSize(event.data.contentLength ?? null);
        } else if (event.event === "Progress") {
          setUpdateDownloaded((downloaded) => downloaded + event.data.chunkLength);
        } else if (event.event === "Finished") {
          setUpdateNotice("Update downloaded. The installer will restart Realty Cockpit.");
        }
      }, { restartAfterInstall: true });
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : String(error));
    } finally {
      setUpdateInstalling(false);
    }
  };

  const closeUpdateDialog = async () => {
    if (updateInstalling) return;
    if (availableUpdate) {
      try {
        await availableUpdate.close();
      } catch (error) {
        setUpdateError(error instanceof Error ? error.message : String(error));
        return;
      }
    }
    setAvailableUpdate(null);
    setUpdateDialogOpen(false);
    setUpdateError(null);
    setUpdateNotice(null);
  };

  if (loading) {
    return (
      <div className="app-shell loading-state">
        <div className="loading-card">Preparing your market brief…</div>
      </div>
    );
  }

  if (!dashboard) {
    return (
      <div className="app-shell loading-state">
        <div className="loading-card error-card">
          <strong>Market data couldn’t be loaded.</strong>
          <span>{loadError ?? "Please restart the app and try again."}</span>
        </div>
      </div>
    );
  }

  const { stats, neighborhoods, searches } = dashboard;
  const selectedNeighborhoodData =
    neighborhoods.find((area) => area.name === selectedNeighborhood) ?? neighborhoods[0] ?? null;
  const neighborhoodListings = selectedNeighborhoodData
    ? dashboard.listings.filter((listing) => listing.neighborhood === selectedNeighborhoodData.name)
    : [];
  const openProperty = (address: string) => {
    setSelectedAddress(address);
    setView("property");
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand-wrap brand-button" onClick={() => setView("dashboard")} aria-label="Go to overview">
          <div className="brand-mark">R</div>
          <div className="brand-copy">
            <div className="brand-name">Realty Cockpit</div>
            <div className="brand-subtitle">Private client intelligence</div>
          </div>
        </button>

        <nav className="main-nav" aria-label="Main navigation">
          {navItems.map((item) => (
            <button
              className={`nav-item ${view === item.id || (view === "property" && item.id === "listings") ? "active" : ""}`}
              key={item.id}
              onClick={() => setView(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>

        <div className="header-actions">
          {!isTauri() && <span className="preview-label">Preview mode</span>}
          {isTauri() && (
            <button className="ghost-button" onClick={() => void checkForUpdates()}>
              Check for updates
            </button>
          )}
          {isTauri() && (
            <button className="ghost-button" onClick={() => { setBackupOpen(true); setBackupError(null); setBackupNotice(null); }}>
              Backup &amp; restore
            </button>
          )}
          <button className="primary-button" onClick={() => setView("listings")}>
            Browse properties <span aria-hidden="true">↗</span>
          </button>
        </div>
      </header>

      <div className="workspace-shell">
        <aside className="sidebar">
          <div className="sidebar-intro">
            <span className="eyebrow">Workspace</span>
            <strong>Seattle · Private office</strong>
          </div>

          <div className="sidebar-block">
            <div className="sidebar-title">Your workspace</div>
            <div className="sidebar-links">
              <button className={view === "dashboard" ? "selected" : ""} onClick={() => setView("dashboard")}>
                <span>◫</span> Market overview
              </button>
              <button className={view === "listings" ? "selected" : ""} onClick={() => setView("listings")}>
                <span>⌂</span> Property portfolio
              </button>
              <button className={view === "map" ? "selected" : ""} onClick={() => setView("map")}>
                <span>⌖</span> Area intelligence
              </button>
            </div>
          </div>

          <div className="sidebar-block">
            <div className="sidebar-title">Saved views</div>
            <ul className="sidebar-list">
              <li className="selected"><span className="view-dot teal" />Active inventory</li>
              <li><span className="view-dot gold" />Investor opportunities</li>
              <li><span className="view-dot blue" />Luxury watchlist</li>
            </ul>
          </div>

          <div className="sidebar-block filter-block">
            <div className="sidebar-title">Refine inventory</div>
            <div className="filter-group search-group">
              <label htmlFor="property-search">Search</label>
              <input
                id="property-search"
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Address or neighborhood"
              />
            </div>
            <div className="filter-group">
              <label>Status</label>
              <div className="filter-options">
                {["All", "Active", "New", "Price Reduced", "Under Offer"].map((option) => (
                  <button
                    key={option}
                    type="button"
                    className={`filter-chip ${statusFilter === option ? "selected" : ""}`}
                    onClick={() => setStatusFilter(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
            <div className="filter-group">
              <label>Price guidance</label>
              <div className="filter-range">$640k <span>to</span> $1.78M</div>
            </div>
            {selectedNeighborhood && (
              <button className="clear-filter" onClick={() => setSelectedNeighborhood(null)}>
                Clear {selectedNeighborhood} filter
              </button>
            )}
            {savedSearchFilter !== null && (
              <button className="clear-filter" onClick={() => setSavedSearchFilter(null)}>
                Clear saved search filter
              </button>
            )}
          </div>

          <div className="sidebar-foot">
            <span className="privacy-mark">◆</span>
            <span>Private by design<br /><strong>Stored on this device</strong></span>
          </div>
        </aside>

        <main className="main-panel">
          {view === "dashboard" && (
            <>
              <section className="hero-panel">
                <div className="hero-copy">
                  <div className="eyebrow hero-eyebrow"><span /> Tuesday, November 3, 2026 <i /> Market briefing</div>
                  <h1>Good decisions<br />start with a clearer view.</h1>
                  <p>A considered view of Seattle’s residential market, curated for your next move.</p>
                  <button className="hero-link" onClick={() => setView("market")}>Explore market intelligence <span>→</span></button>
                </div>
                <div className="hero-art" aria-hidden="true">
                  <div className="art-sun" />
                  <div className="art-building building-back"><i /><i /><i /><i /></div>
                  <div className="art-building building-front"><i /><i /><i /><i /><i /><i /></div>
                  <div className="art-ground" />
                  <span className="art-caption">SEATTLE · PACIFIC NORTHWEST</span>
                </div>
              </section>

              <section className="stats-grid" aria-label="Market summary">
                {stats.map(({ label, value, trend }, index) => (
                  <article className="stat-card" key={label}>
                    <div className="stat-topline"><span className={`stat-icon icon-${index}`}>{["⌂", "◷", "↗", "◎"][index]}</span><span className="stat-trend">{trend}</span></div>
                    <div className="stat-value">{value}</div>
                    <div className="stat-label">{label}</div>
                  </article>
                ))}
              </section>

              <section className="content-grid dashboard-content">
                <article className="panel panel-large">
                  <div className="panel-header">
                    <div>
                      <div className="panel-kicker">Curated inventory</div>
                      <h2>Properties to know</h2>
                    </div>
                    <button className="text-button" onClick={() => setView("listings")}>View all <span>→</span></button>
                  </div>
                  <div className="table-wrap">
                    <table className="listing-table">
                      <thead><tr><th>Property</th><th>Asking</th><th>Beds</th><th>Status</th></tr></thead>
                      <tbody>
                        {visibleListings.slice(0, 5).map((listing) => (
                          <tr
                            key={listing.address}
                            className={selectedAddress === listing.address ? "selected-row" : ""}
                            onClick={() => openProperty(listing.address)}
                            onKeyDown={(event) => { if (event.key === "Enter") openProperty(listing.address); }}
                            tabIndex={0}
                          >
                            <td><strong>{listing.address}</strong><span className="table-subtitle">{listing.neighborhood}</span></td>
                            <td className="price-cell">{listing.price}</td>
                            <td>{listing.beds}</td>
                            <td><span className={`status-badge ${statusClass(listing.status)}`}>{listing.status}</span></td>
                          </tr>
                        ))}
                        {visibleListings.length === 0 && <tr><td className="empty-row" colSpan={4}>No properties match those filters.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </article>

                <div className="side-stack">
                  {selectedListing && (
                    <PropertySummary listing={selectedListing} onOpen={() => openProperty(selectedListing.address)} />
                  )}
                  <article className="panel neighborhood-panel">
                    <div className="panel-header compact">
                      <div><div className="panel-kicker">Local intelligence</div><h2>Neighborhood pulse</h2></div>
                      <button className="icon-button" aria-label="Explore neighborhoods" onClick={() => setView("map")}>↗</button>
                    </div>
                    <div className="neighborhood-list">
                      {neighborhoods.map((area) => (
                        <button className="neighborhood-item" key={area.name} onClick={() => { setSelectedNeighborhood(area.name); setView("map"); }}>
                          <span className="area-initial">{area.name.slice(0, 1)}</span>
                          <span className="area-copy"><strong>{area.name}</strong><small>{area.active_listings} curated properties · {area.median} median</small></span>
                          <span className="trend-tag">{area.yoy}</span>
                        </button>
                      ))}
                    </div>
                  </article>
                </div>
              </section>
            </>
          )}

          {view === "listings" && (
            <section className="page-section">
              <div className="listing-page-heading">
                <PageHeading eyebrow="Private portfolio" title="Property collection" description="A focused view of the homes and opportunities on your radar." />
                <div className="listing-actions">
                  <button className="secondary-button" onClick={() => { setImportOpen(true); setImportSuccess(null); setImportError(null); }}>Import CSV</button>
                  <button className="primary-button" onClick={() => openListingEditor()}>+ Add property</button>
                </div>
              </div>
              <div className="listing-page-grid">
                <article className="panel panel-large">
                  <div className="panel-header">
                    <div><div className="panel-kicker">Showing {visibleListings.length} properties</div><h2>Current inventory</h2></div>
                    {savedSearchFilter !== null && <span className="private-pill">{searches[savedSearchFilter]?.split(":")[0]} criteria</span>}
                  </div>
                  <div className="table-wrap">
                    <table className="listing-table">
                      <thead><tr><th>Property</th><th>Asking</th><th>Details</th><th>Status</th></tr></thead>
                      <tbody>
                        {visibleListings.map((listing) => (
                          <tr key={listing.address} className={selectedAddress === listing.address ? "selected-row" : ""} onClick={() => openProperty(listing.address)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") openProperty(listing.address); }}>
                            <td><strong>{listing.address}</strong><span className="table-subtitle">{listing.neighborhood}</span></td>
                            <td className="price-cell">{listing.price}</td>
                            <td>{listing.beds} bd <span className="muted-separator">·</span> {listing.baths} ba <span className="muted-separator">·</span> {listing.sqft.toLocaleString()} sf</td>
                            <td><span className={`status-badge ${statusClass(listing.status)}`}>{listing.status}</span></td>
                          </tr>
                        ))}
                        {visibleListings.length === 0 && <tr><td className="empty-row" colSpan={4}>No properties match those filters.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </article>
                <div className="portfolio-aside">
                  <article className="panel note-callout"><span className="callout-mark">✦</span><div className="panel-kicker">Curator’s note</div><h2>Thoughtful moves, not more noise.</h2><p>Keep the properties that matter close. Add private notes to remember what stood out at a viewing.</p></article>
                  {selectedListing && <PropertySummary listing={selectedListing} onOpen={() => openProperty(selectedListing.address)} />}
                </div>
              </div>
            </section>
          )}

          {view === "property" && selectedListing && (
            <section className="page-section property-page">
              <button className="back-link" onClick={() => setView("listings")}>← Back to properties</button>
              <div className="property-hero">
                <div className="property-hero-art" aria-hidden="true">
                  <div className="property-sun" />
                  <div className="property-house"><div /><div /><div /></div>
                  <div className="property-land" />
                </div>
                <div className="property-hero-copy">
                  <span className={`status-badge ${statusClass(selectedListing.status)}`}>{selectedListing.status}</span>
                  <div className="panel-kicker">{selectedListing.neighborhood} · Seattle</div>
                  <h1>{selectedListing.address}</h1>
                  <p>{selectedListing.property_type} <span>·</span> Listed {selectedListing.days_on_market} days ago</p>
                  <strong className="property-price">{selectedListing.price}</strong>
                  <button className="secondary-button property-edit-button" onClick={() => openListingEditor(selectedListing)}>Edit property details <span>↗</span></button>
                </div>
              </div>

              <div className="property-detail-grid">
                <div className="property-main-column">
                  <article className="panel property-facts">
                    <div className="panel-header"><div><div className="panel-kicker">At a glance</div><h2>Residence details</h2></div></div>
                    <div className="facts-grid">
                      <div><span>Bedrooms</span><strong>{selectedListing.beds}</strong></div>
                      <div><span>Bathrooms</span><strong>{selectedListing.baths}</strong></div>
                      <div><span>Interior</span><strong>{selectedListing.sqft ? `${selectedListing.sqft.toLocaleString()} sf` : "—"}</strong></div>
                      <div><span>Year built</span><strong>{selectedListing.year_built || "—"}</strong></div>
                      <div><span>Property type</span><strong>{selectedListing.property_type}</strong></div>
                      <div><span>Days on market</span><strong>{selectedListing.days_on_market} days</strong></div>
                    </div>
                  </article>
                  <article className="panel description-panel">
                    <div className="panel-kicker">The residence</div>
                    <h2>A closer look</h2>
                    <p>{selectedListing.description || "A distinctive Seattle residence with a thoughtful layout and a strong connection to its neighborhood."}</p>
                    <div className="detail-highlights"><span>✦ Private client selection</span><span>◷ Updated this week</span></div>
                  </article>
                  <article className="panel notes-panel">
                    <div className="panel-header"><div><div className="panel-kicker">Your private file</div><h2>Viewing notes</h2></div><span className="private-pill">Private</span></div>
                    <label className="visually-hidden" htmlFor="listing-notes">Private notes for {selectedListing.address}</label>
                    <textarea
                      id="listing-notes"
                      value={notesDraft}
                      maxLength={5000}
                      onChange={(event) => { setNotesDraft(event.target.value); setNotesMessage(null); setNotesError(null); }}
                      placeholder="Capture what you noticed, questions to ask, or details to revisit…"
                    />
                    <div className="notes-footer">
                      <span className={notesError ? "form-error" : notesMessage ? "form-success" : ""} role="status">{notesError ?? notesMessage ?? "Only you can see these notes."}</span>
                      <div><small>{notesDraft.length}/5,000</small><button className="primary-button save-button" onClick={() => void saveNotes()} disabled={notesSaving || notesDraft === selectedListing.notes}>{notesSaving ? "Saving…" : "Save notes"}</button></div>
                    </div>
                  </article>
                </div>
                <aside className="property-side-column">
                  <article className="panel market-context">
                    <div className="panel-kicker">Market context</div><h2>{selectedListing.neighborhood}</h2>
                    <p>Explore the neighborhood, local inventory, and recent market direction.</p>
                    <button className="secondary-button" onClick={() => { setSelectedNeighborhood(selectedListing.neighborhood); setView("map"); }}>Explore this neighborhood <span>→</span></button>
                    <div className="context-divider" />
                    <div className="context-row"><span>Asking price</span><strong>{selectedListing.price}</strong></div>
                    <div className="context-row"><span>Listing status</span><strong>{selectedListing.status}</strong></div>
                  </article>
                  <article className="panel contact-card">
                    <span className="contact-avatar">RC</span><div><div className="panel-kicker">Your local desk</div><strong>Seattle market team</strong><small>Research curated for you</small></div>
                  </article>
                </aside>
              </div>
            </section>
          )}

          {view === "map" && (
            <section className="page-section">
              <PageHeading eyebrow="Area intelligence" title="Know the neighborhood." description="Explore the local character and inventory across Seattle’s most watched districts." />
              <div className="map-layout">
                <article className="panel map-panel">
                  <div className="map-heading"><div><div className="panel-kicker">Seattle · neighborhood index</div><h2>Local market map</h2></div><span className="map-legend"><i /> Curated inventory</span></div>
                  <div className="map-canvas" role="group" aria-label="Illustrative Seattle neighborhood map">
                    <svg className="map-art" viewBox="0 0 760 480" preserveAspectRatio="none" aria-hidden="true">
                      <rect width="760" height="480" rx="18" />
                      <path className="map-water" d="M512 -20 C455 62 579 110 500 190 C420 273 554 327 488 500 L800 500 L800 -20 Z" />
                      <path className="map-water-line" d="M512 -20 C455 62 579 110 500 190 C420 273 554 327 488 500" />
                      <path className="map-road" d="M-20 142 C145 178 244 112 392 172 S621 237 790 190" />
                      <path className="map-road" d="M45 -10 C140 123 161 284 254 500" />
                      <path className="map-road" d="M-10 340 C170 291 360 390 774 300" />
                      <path className="map-road minor" d="M140 -5 C260 106 292 250 408 489" />
                      <path className="map-road minor" d="M-10 242 C222 208 397 266 748 144" />
                      <path className="map-road minor" d="M280 -10 C352 126 435 226 730 459" />
                    </svg>
                    <div className="map-label label-water">ELLIOTT BAY</div>
                    <div className="map-label label-city">SEATTLE</div>
                    {neighborhoods.map((area) => {
                      const coordinates = neighborhoodCoordinates[area.name] ?? { left: "50%", top: "50%" };
                      return (
                        <button
                          key={area.name}
                          className={`map-pin ${selectedNeighborhoodData?.name === area.name ? "selected" : ""}`}
                          style={coordinates}
                          onClick={() => setSelectedNeighborhood(area.name)}
                          aria-label={`${area.name}, ${area.active_listings} curated properties`}
                        >
                          <span className="pin-count">{area.active_listings}</span>
                          <span className="pin-name">{area.name}</span>
                        </button>
                      );
                    })}
                    <div className="map-scale"><span /> 2 mi</div>
                  </div>
                </article>
                <aside className="map-neighborhoods">
                  <div className="panel-kicker">Choose an area</div>
                  {neighborhoods.map((area) => (
                    <button className={`area-card ${selectedNeighborhoodData?.name === area.name ? "selected" : ""}`} key={area.name} onClick={() => setSelectedNeighborhood(area.name)}>
                      <span className="area-card-icon">{area.name.slice(0, 1)}</span>
                      <span className="area-copy"><strong>{area.name}</strong><small>{area.active_listings} properties · {area.median} median</small></span>
                      <span className="area-growth">{area.yoy}</span>
                    </button>
                  ))}
                </aside>
              </div>
              {selectedNeighborhoodData && (
                <article className="panel area-drilldown">
                  <div className="panel-header">
                    <div><div className="panel-kicker">Neighborhood profile</div><h2>{selectedNeighborhoodData.name}</h2></div>
                    <button className="text-button" onClick={() => { setSelectedNeighborhood(selectedNeighborhoodData.name); setView("listings"); }}>View all properties <span>→</span></button>
                  </div>
                  <div className="area-metrics">
                    <div><span>Median sale price</span><strong>{selectedNeighborhoodData.median}</strong></div>
                    <div><span>Year-over-year</span><strong className="positive-value">{selectedNeighborhoodData.yoy}</strong></div>
                    <div><span>Curated inventory</span><strong>{selectedNeighborhoodData.active_listings} <small>properties</small></strong></div>
                  </div>
                  <div className="drilldown-list">
                    {neighborhoodListings.length ? neighborhoodListings.map((listing) => (
                      <button className="drilldown-property" key={listing.address} onClick={() => openProperty(listing.address)}>
                        <span className="property-mini-art">⌂</span>
                        <span><strong>{listing.address}</strong><small>{listing.beds} bd · {listing.baths} ba · {listing.sqft.toLocaleString()} sf</small></span>
                        <strong className="price-cell">{listing.price}</strong>
                        <span className={`status-badge ${statusClass(listing.status)}`}>{listing.status}</span>
                        <span className="drilldown-arrow">→</span>
                      </button>
                    )) : <p className="empty-area">No properties are currently listed in this area.</p>}
                  </div>
                </article>
              )}
            </section>
          )}

          {view === "market" && (
            <section className="page-section">
              <PageHeading eyebrow="Seattle · market intelligence" title="A market in perspective." description="A measured overview of pricing, inventory, and neighborhood momentum." />
              <div className="market-summary-grid">
                <article className="panel market-feature">
                  <div className="panel-kicker">Market note · November 2026</div><h2>Steady demand is rewarding well-positioned homes.</h2>
                  <p>Buyer activity remains selective. Move-in-ready homes in established neighborhoods continue to draw the strongest attention, while thoughtful pricing is creating opportunities across the market.</p>
                  <span className="feature-source">LOCAL MARKET BRIEFING <i /> CURATED FOR YOU</span>
                </article>
                <article className="panel price-panel"><div className="panel-kicker">Median sale price</div><strong>$1.08M</strong><span className="positive-value">↗ 6.8% year over year</span><div className="mini-chart" aria-label="Illustrative upward price trend">{[38, 48, 41, 58, 52, 65, 60, 74, 69, 84, 78, 96].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div><small>Illustrative 12-month trend</small></article>
              </div>
              <article className="panel market-table-panel">
                <div className="panel-header"><div><div className="panel-kicker">District comparison</div><h2>Neighborhoods at a glance</h2></div><span className="market-disclaimer">Sample local market data</span></div>
                <div className="neighborhood-market-table">
                  {neighborhoods.map((area, index) => (
                    <button key={area.name} className="market-row" onClick={() => { setSelectedNeighborhood(area.name); setView("map"); }}>
                      <span className="market-rank">0{index + 1}</span><strong>{area.name}</strong><span>{area.active_listings} curated listings</span><strong>{area.median}</strong><span className="positive-value">{area.yoy}</span><span>Explore →</span>
                    </button>
                  ))}
                </div>
              </article>
            </section>
          )}

          {view === "saved" && (
            <section className="page-section">
              <PageHeading eyebrow="Your shortlist" title="Saved for later." description="Search criteria worth keeping close as the market moves." />
              <div className="saved-page-grid">
                {searches.map((search, index) => (
                  <article className="panel saved-search-card" key={search}>
                    <span className="saved-card-number">0{index + 1}</span><div className="panel-kicker">Saved search</div><h2>{search.split(":")[0]}</h2><p>{search.split(":")[1]?.trim()}</p>
                    <button className="secondary-button" onClick={() => { setQuery(""); setStatusFilter("All"); setSelectedNeighborhood(null); setSavedSearchFilter(index); setView("listings"); }}>Review matching properties <span>→</span></button>
                  </article>
                ))}
              </div>
            </section>
          )}
        </main>
      </div>
      <footer className="app-footer"><span>REALTY COCKPIT</span><span>Private market intelligence · Stored on this device</span></footer>
      {editorOpen && (
        <ListingEditor
          listing={editorListing}
          onCancel={() => { setEditorOpen(false); setEditorListing(null); }}
          onSave={saveListing}
        />
      )}
      {importOpen && (
        <ImportDialog
          fileName={importFileName}
          entries={pendingImport}
          error={importError}
          success={importSuccess}
          importing={importing}
          onFileChange={(file) => void selectCsvFile(file)}
          onImport={() => void importCsv()}
          onClose={() => {
            if (importing) return;
            setImportOpen(false);
            setPendingImport(null);
            setImportError(null);
            setImportSuccess(null);
          }}
        />
      )}
      {backupOpen && (
        <BackupDialog
          busy={backupBusy}
          error={backupError}
          notice={backupNotice}
          restorePath={restoreCandidate}
          onBackup={() => void createBackup()}
          onChooseRestore={() => void chooseRestoreFile()}
          onRestore={() => void restoreBackup()}
          onCancelRestore={() => setRestoreCandidate(null)}
          onClose={() => {
            if (backupBusy) return;
            setBackupOpen(false);
            setBackupError(null);
            setBackupNotice(null);
            setRestoreCandidate(null);
          }}
        />
      )}
      {updateDialogOpen && (
        <UpdateDialog
          checking={updateChecking}
          installing={updateInstalling}
          update={availableUpdate}
          error={updateError}
          notice={updateNotice}
          downloaded={updateDownloaded}
          total={updateSize}
          onInstall={() => void installAvailableUpdate()}
          onClose={() => void closeUpdateDialog()}
        />
      )}
    </div>
  );
}

function BackupDialog({
  busy,
  error,
  notice,
  restorePath,
  onBackup,
  onChooseRestore,
  onRestore,
  onCancelRestore,
  onClose,
}: {
  busy: boolean;
  error: string | null;
  notice: string | null;
  restorePath: string | null;
  onBackup: () => void;
  onChooseRestore: () => void;
  onRestore: () => void;
  onCancelRestore: () => void;
  onClose: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="dialog-card backup-dialog" role="dialog" aria-modal="true" aria-labelledby="backup-dialog-title">
        <div className="dialog-header">
          <div><div className="panel-kicker">Local data protection</div><h2 id="backup-dialog-title">Backup &amp; restore</h2></div>
          <button type="button" className="dialog-close" aria-label="Close dialog" disabled={busy} onClick={onClose}>×</button>
        </div>
        <p className="dialog-description">Backups contain your complete local property database, including listing details and private notes. Files stay on your device unless you choose to move them.</p>
        <div className="backup-actions">
          <article className="backup-option">
            <div className="panel-kicker">Create a backup</div>
            <p>Save a portable SQLite copy that you can keep somewhere safe or move to another device.</p>
            <button type="button" className="primary-button" disabled={busy} onClick={onBackup}>{busy ? "Working…" : "Save backup file"}</button>
          </article>
          <article className="backup-option">
            <div className="panel-kicker">Restore from a backup</div>
            <p>Choose a Realty Cockpit database. The selected file is validated before any data is replaced.</p>
            <button type="button" className="secondary-button" disabled={busy} onClick={onChooseRestore}>{busy ? "Working…" : "Choose backup file"}</button>
          </article>
        </div>
        {restorePath && (
          <div className="restore-confirmation">
            <strong>Replace the current property data?</strong>
            <span>Selected backup: {restorePath}</span>
            <p>Your current database will be preserved next to it as a before-restore copy.</p>
            <div>
              <button type="button" className="dialog-cancel" disabled={busy} onClick={onCancelRestore}>Choose another file</button>
              <button type="button" className="primary-button" disabled={busy} onClick={onRestore}>{busy ? "Restoring…" : "Restore and replace"}</button>
            </div>
          </div>
        )}
        {error && <div className="dialog-error" role="alert">{error}</div>}
        {notice && <div className="dialog-success backup-notice" role="status">{notice}</div>}
        <div className="backup-safety-note"><strong>Restore safety:</strong> a copy of the current database is kept beside the active database before restoration.</div>
        <div className="dialog-footer"><span>All database operations run locally on this device.</span><div><button type="button" className="dialog-cancel" disabled={busy} onClick={onClose}>Done</button></div></div>
      </section>
    </div>
  );
}

function UpdateDialog({
  checking,
  installing,
  update,
  error,
  notice,
  downloaded,
  total,
  onInstall,
  onClose,
}: {
  checking: boolean;
  installing: boolean;
  update: Update | null;
  error: string | null;
  notice: string | null;
  downloaded: number;
  total: number | null;
  onInstall: () => void;
  onClose: () => void;
}) {
  const progress = total && total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : null;
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !checking && !installing) onClose(); }}>
      <section className="dialog-card update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-dialog-title">
        <div className="dialog-header">
          <div><div className="panel-kicker">Software updates</div><h2 id="update-dialog-title">{update ? `Version ${update.version} is ready` : "Check for updates"}</h2></div>
          <button type="button" className="dialog-close" aria-label="Close dialog" disabled={checking || installing} onClick={onClose}>×</button>
        </div>
        <p className="dialog-description">Updates are verified before installation and downloaded directly from the Realty Cockpit release channel.</p>
        {checking && <div className="update-status" role="status">Checking for a newer version…</div>}
        {notice && <div className="dialog-success update-status" role="status">{notice}</div>}
        {error && <div className="dialog-error update-status" role="alert">{error}</div>}
        {update && (
          <div className="update-release">
            <div className="update-version-row"><span>Installed version</span><strong>{update.currentVersion}</strong></div>
            <div className="update-version-row"><span>Available version</span><strong>{update.version}</strong></div>
            {update.date && <div className="update-version-row"><span>Release date</span><strong>{new Date(update.date).toLocaleDateString()}</strong></div>}
            {update.body && <div className="update-notes"><strong>Release notes</strong><p>{update.body}</p></div>}
          </div>
        )}
        {installing && (
          <div className="update-progress" role="status">
            <div><span>{progress === 100 ? "Installing update…" : "Downloading update…"}</span><strong>{progress === null ? `${(downloaded / 1_048_576).toFixed(1)} MB` : `${progress}%`}</strong></div>
            <progress max={100} value={progress ?? 0} />
          </div>
        )}
        <div className="dialog-footer">
          <span>Updates are signed and verified before installation.</span>
          <div>
            <button type="button" className="dialog-cancel" disabled={checking || installing} onClick={onClose}>Close</button>
            {update && <button type="button" className="primary-button" disabled={checking || installing} onClick={onInstall}>{installing ? "Updating…" : "Install update"}</button>}
          </div>
        </div>
      </section>
    </div>
  );
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="page-heading"><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>;
}

function PropertySummary({ listing, onOpen }: { listing: Listing; onOpen: () => void }) {
  return (
    <article className="panel detail-panel">
      <div className="panel-header compact"><div><div className="panel-kicker">Selected property</div><h2>{listing.address}</h2></div><span className={`status-badge ${statusClass(listing.status)}`}>{listing.status}</span></div>
      <div className="detail-price">{listing.price}</div>
      <div className="summary-facts"><span>{listing.beds} beds</span><i /> <span>{listing.baths} baths</span><i /> <span>{listing.sqft.toLocaleString()} sf</span></div>
      <div className="detail-meta"><div><span>Neighborhood</span><strong>{listing.neighborhood}</strong></div><div><span>On market</span><strong>{listing.days_on_market} days</strong></div></div>
      <button className="secondary-button full-width" onClick={onOpen}>Open property file <span>→</span></button>
    </article>
  );
}

function ListingEditor({
  listing,
  onCancel,
  onSave,
}: {
  listing: Listing | null;
  onCancel: () => void;
  onSave: (input: ListingInput) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const form = new FormData(event.currentTarget);
    const input: ListingInput = {
      address: String(form.get("address") ?? "").trim(),
      price: Number(form.get("price")),
      beds: Number(form.get("beds")),
      baths: Number(form.get("baths")),
      sqft: Number(form.get("sqft")),
      yearBuilt: Number(form.get("yearBuilt")),
      propertyType: String(form.get("propertyType") ?? "").trim(),
      description: String(form.get("description") ?? "").trim(),
      status: String(form.get("status") ?? "Active"),
      neighborhood: String(form.get("neighborhood") ?? "").trim(),
      daysOnMarket: Number(form.get("daysOnMarket")),
    };

    if (!input.address || !input.neighborhood || !input.propertyType) {
      setError("Address, neighborhood, and property type are required.");
      return;
    }
    if (!Number.isSafeInteger(input.price) || input.price <= 0) {
      setError("Enter a valid asking price greater than zero.");
      return;
    }
    if (
      !Number.isInteger(input.beds) ||
      input.beds < 0 ||
      !Number.isFinite(input.baths) ||
      input.baths < 0 ||
      !Number.isInteger(input.sqft) ||
      input.sqft < 0 ||
      !Number.isInteger(input.yearBuilt) ||
      !Number.isInteger(input.daysOnMarket)
    ) {
      setError("Check the bedrooms, bathrooms, square footage, year, and days on market values.");
      return;
    }

    setSaving(true);
    try {
      await onSave(input);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onCancel(); }}>
      <section className="dialog-card editor-dialog" role="dialog" aria-modal="true" aria-labelledby="listing-editor-title">
        <div className="dialog-header">
          <div><div className="panel-kicker">{listing ? "Update property file" : "Add to your portfolio"}</div><h2 id="listing-editor-title">{listing ? "Edit property" : "New property"}</h2></div>
          <button type="button" className="dialog-close" aria-label="Close dialog" disabled={saving} onClick={onCancel}>×</button>
        </div>
        <form onSubmit={(event) => void handleSubmit(event)}>
          <div className="editor-fields">
            <label className="field-wide">Street address<input name="address" required maxLength={300} defaultValue={listing?.address ?? ""} placeholder="123 Example Street" /></label>
            <label>Asking price (USD)<input name="price" type="number" min="1" step="1" required defaultValue={listing ? Number(listing.price.replace(/[^\d]/g, "")) : ""} placeholder="850000" /></label>
            <label>Neighborhood<input name="neighborhood" required maxLength={120} defaultValue={listing?.neighborhood ?? ""} placeholder="North Shore" /></label>
            <label>Bedrooms<input name="beds" type="number" min="0" max="50" step="1" required defaultValue={listing?.beds ?? 0} /></label>
            <label>Bathrooms<input name="baths" type="number" min="0" max="50" step="0.5" required defaultValue={listing?.baths ?? 0} /></label>
            <label>Interior square feet<input name="sqft" type="number" min="0" max="2000000" step="1" defaultValue={listing?.sqft ?? 0} /></label>
            <label>Year built<input name="yearBuilt" type="number" min="0" max="2200" step="1" defaultValue={listing?.year_built ?? 0} /></label>
            <label>Property type<input name="propertyType" required maxLength={100} defaultValue={listing?.property_type ?? "Single family"} /></label>
            <label>Status
              <select name="status" defaultValue={listing?.status ?? "Active"}>
                {["Active", "New", "Price Reduced", "Under Offer", "Pending", "Sold", "Off Market"].map((status) => <option key={status}>{status}</option>)}
              </select>
            </label>
            <label>Days on market<input name="daysOnMarket" type="number" min="0" max="10000" step="1" defaultValue={listing?.days_on_market ?? 0} /></label>
            <label className="field-wide">Description<textarea name="description" rows={3} maxLength={5000} defaultValue={listing?.description ?? ""} placeholder="Add a short property summary…" /></label>
          </div>
          {error && <div className="dialog-error" role="alert">{error}</div>}
          <div className="dialog-footer"><span>{isTauri() ? "Saved to the local property database." : "Preview changes remain in memory for this session."}</span><div><button type="button" className="dialog-cancel" disabled={saving} onClick={onCancel}>Cancel</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "Saving…" : listing ? "Save changes" : "Add property"}</button></div></div>
        </form>
      </section>
    </div>
  );
}

function ImportDialog({
  fileName,
  entries,
  error,
  success,
  importing,
  onFileChange,
  onImport,
  onClose,
}: {
  fileName: string;
  entries: ListingInput[] | null;
  error: string | null;
  success: string | null;
  importing: boolean;
  onFileChange: (file: File | undefined) => void;
  onImport: () => void;
  onClose: () => void;
}) {
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !importing) onClose(); }}>
      <section className="dialog-card import-dialog" role="dialog" aria-modal="true" aria-labelledby="csv-import-title">
        <div className="dialog-header">
          <div><div className="panel-kicker">Local data import</div><h2 id="csv-import-title">Bring in your properties</h2></div>
          <button type="button" className="dialog-close" aria-label="Close dialog" disabled={importing} onClick={onClose}>×</button>
        </div>
        <p className="dialog-description">Choose a CSV file. It is processed locally and never uploaded. Matching addresses update property details while preserving private notes.</p>
        <div className="import-file-field">
          <label htmlFor="csv-file">Property CSV</label>
          <input id="csv-file" type="file" accept=".csv,text/csv" onChange={(event) => onFileChange(event.currentTarget.files?.[0])} />
          {fileName && <span className="selected-file">{fileName}</span>}
        </div>
        <div className="csv-schema">
          <strong>Required columns</strong>
          <span>address, price, beds, neighborhood</span>
          <small>Optional: baths, sqft, year_built, property_type, description, status, days_on_market. Prices may include $ and commas, or use K/M suffixes.</small>
        </div>
        {entries && <div className="import-preview" role="status"><span>✓</span><strong>{entries.length} properties ready</strong><small>Review your file, then import to the local portfolio.</small></div>}
        {error && <div className="dialog-error" role="alert">{error}</div>}
        {success && <div className="dialog-success" role="status">Import complete: {success}.</div>}
        <div className="dialog-footer import-footer">
          <button type="button" className="template-link" onClick={downloadCsvTemplate}>Download CSV template</button>
          <div>
            <button type="button" className="dialog-cancel" disabled={importing} onClick={onClose}>{success ? "Done" : "Cancel"}</button>
            {entries && <button type="button" className="primary-button" disabled={importing} onClick={onImport}>{importing ? "Importing…" : "Import properties"}</button>}
          </div>
        </div>
      </section>
    </div>
  );
}

export default App;
