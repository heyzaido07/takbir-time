// ========================================
// UI COMPONENTS
// ========================================

function formatDistance(km) {
  return km < 1 ? `${(km * 1000).toFixed(0)}m` : `${km.toFixed(1)}km`;
}

function formatDateTime(isoString) {
  if (!isoString) return "–";
  return new Date(isoString).toLocaleString();
}

function formatTimeAgo(timestamp) {
  if (!timestamp) return 'Unknown date';
  const now = new Date();
  const then = new Date(timestamp);

  if (isNaN(then.getTime())) return 'Invalid date';

  const diffMs = now - then;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  return then.toLocaleDateString();
}



function createReminderClock(minutes, prayerKey, enabled) {
  // Visual states: active (enabled) vs inactive (disabled)
  const color = enabled ? '#10b981' : '#9ca3af';
  const bgColor = enabled ? 'rgba(16, 185, 129, 0.1)' : 'rgba(156, 163, 175, 0.05)';
  const textColor = enabled ? '#059669' : '#94a3b8';
  const strokeWidth = enabled ? '2' : '1.5';
  const opacity = enabled ? '1' : '0.6';

  const svg = `
    <svg viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg" style="opacity: ${opacity}">
      <!-- Background circle -->
      <circle cx="20" cy="20" r="18" fill="${bgColor}" stroke="${color}" stroke-width="${strokeWidth}" />

      <!-- Minutes text -->
      <text x="20" y="24" text-anchor="middle" font-size="12" font-weight="700" fill="${textColor}">${minutes}</text>
    </svg>
  `;

  const title = enabled
    ? `Reminder enabled - ${minutes} min before ${prayerKey}. Click to edit.`
    : `Reminder disabled. Click to configure.`;

  return `<span class="reminder-timer ${enabled ? 'active' : 'inactive'}"
                onclick="openReminderModal('${prayerKey}', ${minutes}, ${enabled})"
                title="${title}">${svg}</span>`;
}

function createMosqueCard(mosque) {
  const isFavorite = state.user.favoriteMosques.includes(mosque.id);
  const defaultMosqueId = storage.getDefaultMosque();
  const isDefault = mosque.id === defaultMosqueId;

  const card = document.createElement("div");
  card.className = `mosque-card ${isDefault ? 'default-mosque' : ''}`;
  card.dataset.id = mosque.id;

  // Amenities HTML
  const amenitiesHtml = mosque.amenities ? mosque.amenities.slice(0, 3).map(a => {
    const labels = {
      'parking': '🅿️ Parking',
      'wudu_facilities': '💧 Wudu',
      'womens_section': '🧕 Women',
      'wheelchair_accessible': '♿ Wheelchair',
      'ac': '❄️ AC',
      'library': '📚 Library',
      'school': '🏫 School',
      'jummah_2': '2️⃣ Jummah 2',
      'jummah_3': '3️⃣ Jummah 3'
    };
    return `<span class="chip-outline" style="font-size: 10px; padding: 2px 6px;">${labels[a] || a}</span>`;
  }).join('') : '';

  card.innerHTML = `
    <div class="mosque-card-header">
      <div class="mosque-actions">
        <button type="button" class="btn btn-sm btn-outline" onclick="selectMosque('${mosque.id}')">
          🕰️ View
        </button>
        <button type="button" class="favorite-toggle ${isFavorite ? 'active' : ''}"
          onclick="event.stopPropagation(); toggleFavorite('${mosque.id}')">
          <span>⭐</span>
        </button>
      </div>
    </div>

    <div class="mosque-card-content">
      <div class="mosque-name">
        ${mosque.name}
        ${isDefault ? '<span class="chip-accent" style="margin-left: 8px; font-size: 11px; padding: 2px 8px;">🏠 Default</span>' : ''}
      </div>
      <div class="mosque-meta">${mosque.address}, ${mosque.city}</div>

      <div class="flex-gap" style="margin-top: 8px; margin-bottom: 8px;">
        <span class="pill">📏 ${formatDistance(mosque.distanceKm)}</span>
        <span class="pill">⭐ ${mosque.rating.toFixed(1)}</span>
        <span class="pill">👥 ${mosque.contributorCount} contributors</span>
      </div>

      <div class="flex-gap" style="flex-wrap: wrap; gap: 4px;">
        ${amenitiesHtml}
        ${mosque.amenities && mosque.amenities.length > 3 ? `<span class="chip-outline" style="font-size: 10px; padding: 2px 6px;">+${mosque.amenities.length - 3} more</span>` : ''}
      </div>
    </div>
  `;

  card.addEventListener("click", () => selectMosque(mosque.id));
  return card;
}

function renderMosqueList(customItems = null) {
  console.log("renderMosqueList called", { customItems, stateMosques: state.mosques });
  const listEl = document.getElementById("mosque-list");
  const searchValue = document.getElementById("list-search-input")?.value.toLowerCase();
  const sortValue = document.getElementById("filter-select")?.value;

  listEl.innerHTML = "";

  // If customItems (categorized) are provided, render them
  if (customItems && Array.isArray(customItems) && customItems.length > 0 && customItems[0].title) {
    console.log("Rendering categorized items", customItems);
    customItems.forEach(section => {
      if (section.items.length === 0) return;

      const header = document.createElement("div");
      header.className = "small-label";
      header.style.marginTop = "12px";
      header.style.marginBottom = "8px";
      header.style.color = "var(--primary)";
      header.textContent = section.title;
      listEl.appendChild(header);

      section.items.forEach(mosque => {
        listEl.appendChild(createMosqueCard(mosque));
      });
    });
    return;
  }

  // Default behavior (flat list)
  let items = customItems || [...state.mosques];
  console.log("Initial items:", items);

  if (!customItems) {
    // Filter by search
    if (searchValue) {
      items = items.filter(m => {
        const haystack = (m.name + " " + m.address + " " + m.city).toLowerCase();
        return haystack.includes(searchValue);
      });
    }

    // ✨ Filter by amenities
    const selectedAmenities = Array.from(document.querySelectorAll('.chip-outline.active'))
      .map(chip => chip.dataset.amenity);

    if (selectedAmenities.length > 0) {
      items = items.filter(m =>
        selectedAmenities.every(amenity => m.amenities && m.amenities.includes(amenity))
      );
    }

    // Sort
    if (sortValue === "distance") {
      items.sort((a, b) => a.distanceKm - b.distanceKm);
    } else if (sortValue === "rating") {
      items.sort((a, b) => b.rating - a.rating);
    } else if (sortValue === "recent") {
      items.sort((a, b) => new Date(b.lastUpdated) - new Date(a.lastUpdated));
    }
  }

  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "small-label";
    empty.textContent = "No mosques found matching your search.";
    listEl.appendChild(empty);
    return;
  }

  items.forEach(mosque => {
    listEl.appendChild(createMosqueCard(mosque));
  });
}

function renderFavorites() {
  const container = document.getElementById("favorites-list");
  container.innerHTML = "";

  const favorites = state.user.favoriteMosques
    .map(id => getMosqueById(id))
    .filter(Boolean);

  const defaultMosqueId = storage.getDefaultMosque();

  // ✨ Update default mosque info box
  const defaultMosque = getMosqueById(defaultMosqueId);
  const defaultInfoBox = document.getElementById('default-mosque-info');
  const defaultMosqueName = document.getElementById('default-mosque-name');

  if (defaultMosque) {
    defaultInfoBox.style.display = 'block';
    defaultMosqueName.textContent = defaultMosque.name;
  } else {
    defaultInfoBox.style.display = 'none';
  }

  if (!favorites.length) {
    const empty = document.createElement("div");
    empty.className = "small-label";
    empty.textContent = "You haven't added any favorites yet. Click ⭐ on mosques to add them here.";
    container.appendChild(empty);
    return;
  }

  favorites.forEach(mosque => {
    const isDefault = mosque.id === defaultMosqueId;
    const card = document.createElement("div");
    card.className = `mosque-card active ${isDefault ? 'default-mosque' : ''} `;
    card.dataset.id = mosque.id;
    card.innerHTML = `
    <div class="mosque-card-header">
      <div class="mosque-actions">
        ${!isDefault ? `
          <button type="button" class="btn btn-sm btn-outline"
            onclick="event.stopPropagation(); setAsDefaultMosque('${mosque.id}')"
            title="Set as default mosque">
            🏠 Set Default
          </button>
        ` : ''}
        <button type="button" class="btn btn-sm btn-outline" onclick="selectMosque('${mosque.id}')">
          🕰️ View
        </button>
        <button type="button" class="favorite-toggle active"
          onclick="event.stopPropagation(); toggleFavorite('${mosque.id}')">
          <span>⭐</span>
        </button>
      </div>
    </div>

    <div class="mosque-card-content">
      <div class="mosque-name">
        ${mosque.name}
        ${isDefault ? '<span class="chip-accent" style="margin-left: 8px; font-size: 11px; padding: 2px 8px;">🏠 Default</span>' : ''}
      </div>
      <div class="mosque-meta">${mosque.address}, ${mosque.city}</div>
      <div class="flex-gap">
        <span class="pill">📏 ${formatDistance(mosque.distanceKm)}</span>
        <span class="pill">⭐ ${mosque.rating.toFixed(1)}</span>
      </div>
    </div>
  `;
    card.addEventListener("click", () => selectMosque(mosque.id));
    container.appendChild(card);
  });
}
