// ========================================
// MAIN APPLICATION LOGIC
// ========================================

// Helper functions
function showToast(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 3000);
}

function getMosqueById(id) {
    return state.mosques.find(m => m.id === id) || null;
}

function isFavorite(mosqueId) {
    return state.user.favoriteMosques.includes(mosqueId);
}

async function toggleFavorite(mosqueId) {
    await api.toggleFavorite(mosqueId);
    renderMosqueList();
    renderFavorites();
    updateDetailFavoriteButton();
    updateProfile();
    showToast(isFavorite(mosqueId) ? "Added to favorites" : "Removed from favorites");
}

// View switching
function switchView(viewName) {
    state.currentView = viewName;
    document.querySelectorAll(".view").forEach(v => {
        v.classList.toggle("is-active", v.id === "view-" + viewName);
    });
    document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.view === viewName);
    });

    if (viewName === "favorites") {
        renderFavorites();
    } else if (viewName === "profile") {
        updateProfile();
    }
}

// ✨ Tab switching
function initTabs() {
    document.querySelectorAll('.detail-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;

            document.querySelectorAll('.detail-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            document.querySelectorAll('.tab-panel').forEach(panel => {
                panel.style.display = panel.dataset.panel === tabName ? 'block' : 'none';
            });
        });
    });
}

// ✨ NEW: Lazy load Google Maps to reduce API hits
let mapsLoaded = false;
let mapsLoading = false;

function loadGoogleMaps() {
    if (mapsLoaded || mapsLoading) return;

    mapsLoading = true;
    const placeholder = document.getElementById('map-placeholder');
    placeholder.innerHTML = `
    <div style="font-size: 48px; margin-bottom: 16px;">⏳</div>
    <p style="color: var(--text-muted);">Loading map...</p>
  `;

    const script = document.createElement('script');
    script.src = 'https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY&libraries=places&callback=initMap';
    script.async = true;
    script.defer = true;
    script.onerror = () => {
        placeholder.innerHTML = `
      <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
      <p style="color: var(--danger);">Failed to load map. Check your API key.</p>
    `;
        mapsLoading = false;
    };
    document.head.appendChild(script);
}

// Google Maps initialization
function initMap() {
    mapsLoaded = true;
    const placeholder = document.getElementById('map-placeholder');
    const mapElement = document.getElementById('map');

    // Hide placeholder, show map
    placeholder.style.display = 'none';
    mapElement.style.display = 'block';

    const defaultCenter = { lat: 31.5204, lng: 74.3587 };

    state.map = new google.maps.Map(document.getElementById("map"), {
        zoom: 13,
        center: defaultCenter,
        styles: [
            {
                "featureType": "all",
                "elementType": "geometry",
                "stylers": [{ "color": "#242f3e" }]
            },
            {
                "featureType": "all",
                "elementType": "labels.text.stroke",
                "stylers": [{ "color": "#242f3e" }]
            },
            {
                "featureType": "all",
                "elementType": "labels.text.fill",
                "stylers": [{ "color": "#746855" }]
            },
            {
                "featureType": "water",
                "elementType": "geometry",
                "stylers": [{ "color": "#17263c" }]
            }
        ]
    });

    // Add mosque markers with staggered animation
    state.mosques.forEach((mosque, index) => {
        const marker = new google.maps.Marker({
            position: mosque.coordinates,
            map: state.map,
            title: mosque.name,
            animation: google.maps.Animation.DROP,
            icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 10,
                fillColor: "#10b981",
                fillOpacity: 1,
                strokeColor: "#ffffff",
                strokeWeight: 2
            }
        });

        // Staggered drop animation
        setTimeout(() => {
            marker.setAnimation(google.maps.Animation.DROP);
        }, index * 100);

        const infoWindow = new google.maps.InfoWindow({
            content: `
        <div class="custom-info-window">
          <h3>${mosque.name}</h3>
          <p><strong>Address:</strong> ${mosque.address}</p>
          <p><strong>Distance:</strong> ${formatDistance(mosque.distanceKm)}</p>
          <p><strong>Rating:</strong> ⭐ ${mosque.rating.toFixed(1)}</p>
          <button class="btn btn-primary btn-sm" onclick="selectMosque('${mosque.id}')">View Timings</button>
        </div>
      `
        });

        marker.addListener("click", () => {
            state.markers.forEach(m => m.infoWindow.close());
            infoWindow.open(state.map, marker);
            selectMosque(mosque.id);
        });

        state.markers.push({ marker, infoWindow, mosqueId: mosque.id });
    });

    // Search box
    const searchInput = document.getElementById("map-search-input");
    const searchBox = new google.maps.places.SearchBox(searchInput);

    state.map.addListener("bounds_changed", () => {
        searchBox.setBounds(state.map.getBounds());
    });

    searchBox.addListener("places_changed", () => {
        const places = searchBox.getPlaces();
        if (places.length === 0) return;

        const place = places[0];
        if (!place.geometry || !place.geometry.location) return;

        state.map.setCenter(place.geometry.location);
        state.map.setZoom(15);
    });

    // Get user location
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const userPos = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };
                state.userLocation = userPos;
                state.map.setCenter(userPos);

                new google.maps.Marker({
                    position: userPos,
                    map: state.map,
                    icon: {
                        path: google.maps.SymbolPath.CIRCLE,
                        scale: 8,
                        fillColor: "#3b82f6",
                        fillOpacity: 1,
                        strokeColor: "#ffffff",
                        strokeWeight: 2
                    },
                    title: "Your location"
                });

                document.getElementById("location-status").textContent = "Location detected";
            },
            () => {
                document.getElementById("location-status").textContent = "Using default location";
            }
        );
    }
}

// Mosque selection and detail view
// Mosque detail panel rendering functions
function renderTimingsTable(timings) {
    const tbody = document.getElementById("timings-body");
    tbody.innerHTML = "";
    const entries = [
        { key: "fajr", label: "Fajr" },
        { key: "zuhr", label: "Zuhr" },
        { key: "asr", label: "Asr" },
        { key: "maghrib", label: "Maghrib" },
        { key: "isha", label: "Isha" },
        { key: "jummah", label: "Jummah" },
        { key: "jummah_2", label: "Jummah 2" },
        { key: "jummah_3", label: "Jummah 3" }
    ];

    // Get reminder preferences
    const reminderPrefs = JSON.parse(localStorage.getItem('reminder_preferences') || '{}');

    const next = computeNextPrayer(timings);
    entries.forEach(entry => {
        // Skip Jummah 2/3 if they don't have timings
        if ((entry.key === 'jummah_2' || entry.key === 'jummah_3') && !timings[entry.key]) {
            return;
        }

        const tr = document.createElement("tr");
        if (next.nextPrayerKey === entry.key) tr.classList.add("highlight");

        // Reminder clock for non-Jummah prayers
        let reminderIndicator = '';
        if (!entry.key.startsWith('jummah')) {
            const reminder = reminderPrefs[entry.key] || { enabled: false, minutes: 15 };
            reminderIndicator = createReminderClock(reminder.minutes, entry.key, reminder.enabled);
        }

        tr.innerHTML = `
            <td>${entry.label}${reminderIndicator}</td>
            <td style="font-weight: 600;">${timings[entry.key] || '–'}</td>
            <td>${next.nextPrayerKey === entry.key ? "Next prayer" : "–"}</td>
        `;
        tbody.appendChild(tr);
    });
    document.getElementById("next-prayer-name").textContent = next.nextPrayerName || "All completed";
}

function renderAmenities(amenities) {
    const container = document.getElementById('amenities-list');
    container.innerHTML = '';

    if (!amenities || amenities.length === 0) {
        container.innerHTML = '<div class="small-label">No amenities listed</div>';
        return;
    }

    const amenityIcons = {
        'parking': '🅿️',
        'wudu_facilities': '🚰',
        'womens_section': '🧕',
        'wheelchair_accessible': '♿',
        'library': '📚',
        'school': '🏫',
        'ac': '❄️',
        'jummah_2': '2️⃣',
        'jummah_3': '3️⃣'
    };

    amenities.forEach(amenity => {
        const badge = document.createElement('div');
        badge.className = 'amenity-badge';
        badge.innerHTML = `
            <span class="icon">${amenityIcons[amenity] || '✓'}</span>
            <span>${amenity.replace(/_/g, ' ')}</span>
        `;
        container.appendChild(badge);
    });
}

function renderContributors(mosqueId) {
    const container = document.getElementById('submissions-list');
    const submissions = state.submissions[mosqueId] || [];

    if (submissions.length === 0) {
        container.innerHTML = `
            <div style="text-align: center; padding: 40px 20px; color: var(--text-muted);">
                <div style="font-size: 48px; margin-bottom: 12px;">📊</div>
                <p>No timing submissions yet</p>
                <p style="font-size: 12px; margin-top: 8px;">Be the first to contribute!</p>
            </div>
        `;
        return;
    }

    container.innerHTML = '';

    // Sort: pending first, then active, then outdated
    const sortedSubmissions = [...submissions].sort((a, b) => {
        const order = { pending_verification: 0, active: 1, outdated: 2 };
        return order[a.status] - order[b.status];
    });

    sortedSubmissions.forEach(sub => {
        const card = document.createElement('div');
        card.className = 'submission-card';

        // Status badge
        let statusBadge = '';
        let statusColor = '';
        if (sub.status === 'active') {
            statusBadge = '✓ Active';
            statusColor = 'var(--primary)';
        } else if (sub.status === 'pending_verification') {
            statusBadge = '⏳ Pending Verification';
            statusColor = 'var(--accent)';
        } else {
            statusBadge = '⌛ Outdated';
            statusColor = 'var(--text-muted)';
        }

        // Top contributor badge
        const contributorBadge = sub.isTopContributor
            ? '<span style="background: rgba(16,185,129,0.2); color: var(--primary); padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-left: 6px;">⭐ Top Contributor</span>'
            : '';

        // Time ago
        const timeAgo = formatTimeAgo(sub.submittedAt);

        // Verification count
        const verificationInfo = sub.verified
            ? `<span style="color: var(--primary); font-size: 12px;">✓ Verified by ${sub.verifiedBy} contributor${sub.verifiedBy !== 1 ? 's' : ''}</span>`
            : `<span style="color: var(--accent); font-size: 12px;">⏳ Needs verification</span>`;

        // User default preference
        const userDefaults = JSON.parse(localStorage.getItem('jamat_user_defaults') || '{}');
        const isUserDefault = userDefaults[mosqueId] === sub.id;

        // Build timings grid - ALWAYS show all 8 prayers
        const prayers = [
            { key: 'fajr', label: 'Fajr' },
            { key: 'zuhr', label: 'Zuhr' },
            { key: 'asr', label: 'Asr' },
            { key: 'maghrib', label: 'Maghrib' },
            { key: 'isha', label: 'Isha' },
            { key: 'jummah', label: 'Jummah' },
            { key: 'jummah_2', label: 'Jummah 2' },
            { key: 'jummah_3', label: 'Jummah 3' }
        ];

        let timingsHTML = '';
        prayers.forEach(prayer => {
            const time = sub.timings[prayer.key] || '–';
            timingsHTML += `<div><strong>${prayer.label}:</strong> ${time}</div>`;
        });

        // Simplified actions - Thumbs up/down for everyone
        const actionsHTML = `
            <div style="display: flex; gap: 12px; margin-top: 12px; align-items: center; flex-wrap: wrap;">
                <button class="btn btn-outline btn-sm" onclick="setContributorAsDefault('${sub.id}', '${mosqueId}')" style="flex: 0 0 auto;">
                    ${isUserDefault ? '✓ Your Default' : '🏠 Set as Default'}
                </button>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <button class="btn btn-sm" onclick="handleThumbsUp('${sub.id}', '${mosqueId}')" style="background: rgba(16,185,129,0.15); border: 1px solid var(--primary); color: var(--primary); padding: 8px 16px;" title="Verify these timings are correct">
                        👍 Correct
                    </button>
                    <button class="btn btn-sm" onclick="handleThumbsDown('${sub.id}', '${mosqueId}')" style="background: rgba(239,68,68,0.15); border: 1px solid #ef4444; color: #ef4444; padding: 8px 16px;" title="Submit corrected timings">
                        👎 Incorrect
                    </button>
                </div>
            </div>
        `;

        card.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                <div>
                    <div style="font-weight: 600; color: var(--text-main);">
                        ${sub.userName}
                        ${contributorBadge}
                    </div>
                    <div style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
                        Reputation: ${sub.userReputation} · ${timeAgo}
                    </div>
                </div>
                <span style="color: ${statusColor}; font-size: 12px; font-weight: 600;">${statusBadge}</span>
            </div>

            <div style="background: rgba(15,23,42,0.5); border-radius: 8px; padding: 10px; margin: 8px 0;">
                <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(70px, 1fr)); gap: 8px; font-size: 12px;">
                    ${timingsHTML}
                </div>
            </div>

            ${sub.notes ? `<div style="font-size: 12px; color: var(--text-muted); font-style: italic; margin: 8px 0;">📝 "${sub.notes}"</div>` : ''}

            <div style="margin-top: 8px;">
                ${verificationInfo}
            </div>

            ${actionsHTML}
        `;

        container.appendChild(card);
    });
}


// Mosque selection and detail view
function selectMosque(mosqueId) {
    state.selectedMosqueId = mosqueId;
    const mosque = getMosqueById(mosqueId);
    if (!mosque) return;

    // Update detail panel
    document.getElementById("detail-mosque-name").textContent = mosque.name;
    document.getElementById("detail-mosque-address").textContent =
        `${mosque.address}, ${mosque.city}, ${mosque.country}`;
    document.getElementById("detail-distance").textContent = formatDistance(mosque.distanceKm);
    document.getElementById("detail-rating").textContent = `⭐ ${mosque.rating.toFixed(1)}`;
    document.getElementById("detail-contributors").textContent = mosque.contributorCount;
    document.getElementById("detail-last-updated").textContent = formatDateTime(mosque.lastUpdated);
    document.getElementById("detail-contact").textContent = mosque.phoneNumber || "Not provided";

    // Show tabs and content
    document.getElementById("detail-tabs").style.display = "flex";
    document.getElementById("detail-content").style.display = "block";
    document.getElementById("detail-placeholder").style.display = "none";
    document.getElementById("detail-favorite-toggle").style.display = "flex";

    // ✨ Update Default Toggle Button
    const defaultBtn = document.getElementById("detail-default-toggle");
    defaultBtn.style.display = "flex";
    const isDefault = storage.getDefaultMosque() === state.selectedMosqueId;
    defaultBtn.innerHTML = isDefault
        ? '<span>🏠</span><span>Remove Default</span>'
        : '<span>🏠</span><span>Set Default</span>';
    defaultBtn.classList.toggle('btn-primary', isDefault);
    defaultBtn.classList.toggle('btn-outline', !isDefault);

    // ✨ Determine which timings to show
    // 1. Check for user's explicit default preference
    const userDefaults = JSON.parse(localStorage.getItem('jamat_user_defaults') || '{}');
    const preferredSubmissionId = userDefaults[mosqueId];

    let timingsToShow = mosque.defaultJamaatTimings;
    let sourceLabel = 'Community Default';

    if (preferredSubmissionId) {
        const submissions = state.submissions[mosqueId] || [];
        const preferredSub = submissions.find(s => s.id === preferredSubmissionId);
        if (preferredSub) {
            timingsToShow = preferredSub.timings;
            sourceLabel = `Selected: ${preferredSub.userName}`;
        }
    } else {
        // 2. Fallback to highest rated contributor (if any)
        const submissions = state.submissions[mosqueId] || [];
        if (submissions.length > 0) {
            // Sort by verification score
            const sorted = [...submissions].sort((a, b) => (b.verifiedBy || 0) - (a.verifiedBy || 0));
            const topSub = sorted[0];
            // Only use if it has some verification
            if (topSub.verifiedBy > 0) {
                timingsToShow = topSub.timings;
                sourceLabel = `Top Rated: ${topSub.userName}`;
            }
        }
    }

    // Render components
    renderTimingsTable(timingsToShow);
    renderAmenities(mosque.amenities);
    renderContributors(mosqueId);
    updateDetailFavoriteButton();
    startCountdown(timingsToShow);

    // Highlight mosque card
    document.querySelectorAll(".mosque-card").forEach(card => {
        card.classList.toggle("active", card.dataset.id === mosqueId);
    });

    // Scroll detail into view on mobile
    if (window.innerWidth < 1024) {
        document.getElementById('detail-card').scrollIntoView({ behavior: 'smooth' });
    }
}

// ✨ Set a contributor as my default
function setContributorAsDefault(submissionId, mosqueId) {
    const userDefaults = JSON.parse(localStorage.getItem('jamat_user_defaults') || '{}');

    // Toggle logic: if already selected, unselect it
    if (userDefaults[mosqueId] === submissionId) {
        delete userDefaults[mosqueId];
        showToast("Removed as default. Using community top rated.");
    } else {
        userDefaults[mosqueId] = submissionId;
        showToast("✓ Set as your default timings for this mosque");
    }

    localStorage.setItem('jamat_user_defaults', JSON.stringify(userDefaults));

    // Refresh view to apply changes
    selectMosque(mosqueId);
}

// ✨ Toggle default mosque (main button)
function toggleDefaultMosque(mosqueId) {
    const currentDefault = storage.getDefaultMosque();
    if (currentDefault === mosqueId) {
        storage.saveDefaultMosque(null);
        showToast("Removed as default mosque");
    } else {
        storage.saveDefaultMosque(mosqueId);
        const mosque = getMosqueById(mosqueId);
        showToast(`✓ ${mosque.name} set as your default mosque`);
    }
    selectMosque(mosqueId);
    renderFavorites();
}

// ✨ Toggle reminder on/off
function toggleReminder(prayerKey) {
    const reminderPrefs = JSON.parse(localStorage.getItem('reminder_preferences') || '{}');

    // If preference doesn't exist, create it
    if (!reminderPrefs[prayerKey]) {
        reminderPrefs[prayerKey] = { enabled: false, minutes: 15 };
    }

    // Toggle the enabled state
    reminderPrefs[prayerKey].enabled = !reminderPrefs[prayerKey].enabled;
    localStorage.setItem('reminder_preferences', JSON.stringify(reminderPrefs));

    // Re-render timings table to show updated state
    const mosque = getMosqueById(state.selectedMosqueId);
    if (mosque) {
        renderTimingsTable(mosque.defaultJamaatTimings);
    }

    // Show toast notification
    const prayerName = prayerKey.charAt(0).toUpperCase() + prayerKey.slice(1);
    const message = reminderPrefs[prayerKey].enabled
        ? `✓ Reminder enabled for ${prayerName} (${reminderPrefs[prayerKey].minutes} min before)`
        : `Reminder disabled for ${prayerName}`;
    showToast(message);
}

// ✨ Open reminder modal
function openReminderModal(prayerKey, currentMinutes, enabled) {
    const modal = document.getElementById('reminder-modal');
    const input = document.getElementById('reminder-minutes-input');
    const toggle = document.getElementById('reminder-enabled-toggle');
    const prayerName = document.getElementById('reminder-prayer-name');
    const timeSettings = document.getElementById('reminder-time-settings');

    input.value = currentMinutes;
    toggle.checked = enabled;
    prayerName.textContent = prayerKey;
    modal.dataset.prayerKey = prayerKey;

    // Show/hide time settings based on enabled state
    timeSettings.style.display = enabled ? 'block' : 'none';

    modal.style.display = 'flex';
}

function toggleReminderEnabled() {
    const toggle = document.getElementById('reminder-enabled-toggle');
    const timeSettings = document.getElementById('reminder-time-settings');
    timeSettings.style.display = toggle.checked ? 'block' : 'none';
}

function closeReminderModal() {
    document.getElementById('reminder-modal').style.display = 'none';
}

function saveReminderSettings() {
    const modal = document.getElementById('reminder-modal');
    const prayerKey = modal.dataset.prayerKey;
    const minutes = parseInt(document.getElementById('reminder-minutes-input').value);
    const enabled = document.getElementById('reminder-enabled-toggle').checked;

    if (enabled && (isNaN(minutes) || minutes < 1 || minutes > 120)) {
        showToast('Please enter a valid number between 1 and 120');
        return;
    }

    const reminderPrefs = JSON.parse(localStorage.getItem('reminder_preferences') || '{}');
    if (!reminderPrefs[prayerKey]) {
        reminderPrefs[prayerKey] = { enabled: false, minutes: 15 };
    }

    reminderPrefs[prayerKey].enabled = enabled;
    if (enabled) {
        reminderPrefs[prayerKey].minutes = minutes;
    }

    localStorage.setItem('reminder_preferences', JSON.stringify(reminderPrefs));

    const mosque = getMosqueById(state.selectedMosqueId);
    if (mosque) {
        renderTimingsTable(mosque.defaultJamaatTimings);
    }

    const statusMsg = enabled
        ? `Reminder set: ${minutes} min before ${prayerKey}`
        : `Reminder disabled for ${prayerKey}`;
    showToast(statusMsg);
    closeReminderModal();
}

// ✨ Verify submission (top contributor action)
function verifySubmission(submissionId, mosqueId) {
    if (!state.auth.isLoggedIn) {
        showToast("Please sign in to verify submissions");
        showSignInModal();
        return;
    }

    const submissions = state.submissions[mosqueId];
    const submission = submissions.find(s => s.id === submissionId);

    if (!submission) return;

    const currentUserId = state.auth.user.id;

    // 1. Prevent self-verification
    if (submission.userId === currentUserId) {
        showToast("You cannot verify your own submission");
        return;
    }

    // Initialize verifications array if missing
    if (!submission.verifications) {
        submission.verifications = [];
    }

    // 2. Prevent double voting
    if (submission.verifications.includes(currentUserId)) {
        showToast("You have already verified this submission");
        return;
    }

    // 3. Weighted verification
    let weight = 1;
    const userContrib = state.userContributions[mosqueId];
    if (userContrib && userContrib.isTopContributor) {
        weight = 3; // Top contributors have more weight
    } else if (state.user.reputation > 500) {
        weight = 2; // High reputation users have more weight
    }

    submission.verifications.push(currentUserId);
    submission.verifiedBy += weight; // Add weight instead of just 1

    // Check threshold (e.g., 5 points)
    if (submission.verifiedBy >= 5) {
        submission.verified = true;
        submission.status = 'active';

        // Update mosque default timings
        const mosque = getMosqueById(mosqueId);
        if (mosque) {
            mosque.defaultJamaatTimings = { ...submission.timings };
            renderTimingsTable(mosque.defaultJamaatTimings);
            startCountdown(mosque.defaultJamaatTimings);
        }
        showToast(`✓ Submission verified! (+${weight} contribution)`);
    } else {
        showToast(`✓ Verification recorded (+${weight} points). Needs ${5 - submission.verifiedBy} more.`);
    }

    renderContributors(mosqueId);
    state.user.reputation += 5; // Reward for verifying
    updateProfile();
}

// ✨ Copy timings from submission
function copyTimings(submissionId, mosqueId) {
    const submissions = state.submissions[mosqueId];
    const submission = submissions.find(s => s.id === submissionId);

    if (!submission) return;

    // Pre-fill update form with these timings
    document.getElementById('update-form').elements['fajr'].value = submission.timings.fajr;
    document.getElementById('update-form').elements['zuhr'].value = submission.timings.zuhr;
    document.getElementById('update-form').elements['asr'].value = submission.timings.asr;
    document.getElementById('update-form').elements['maghrib'].value = submission.timings.maghrib;
    document.getElementById('update-form').elements['isha'].value = submission.timings.isha;
    document.getElementById('update-form').elements['jummah'].value = submission.timings.jummah || '';

    // Open update modal
    document.getElementById("update-modal").style.display = "flex";

    showToast('📋 Timings copied! Review and submit');
}

// ✨ Handle dispute (Thumbs Down)
function handleDispute(submissionId, mosqueId) {
    if (!state.auth.isLoggedIn) {
        showToast("Please sign in to dispute submissions");
        showSignInModal();
        return;
    }

    const submissions = state.submissions[mosqueId];
    const submission = submissions.find(s => s.id === submissionId);
    if (!submission) return;

    // Pre-fill update form with these timings
    const form = document.getElementById('update-form');
    form.fajr.value = submission.timings.fajr;
    form.zuhr.value = submission.timings.zuhr;
    form.asr.value = submission.timings.asr;
    form.maghrib.value = submission.timings.maghrib;
    form.isha.value = submission.timings.isha;
    form.jummah.value = submission.timings.jummah || '';
    form.notes.value = `Correction for ${submission.userName}'s submission`;

    // Store dispute context
    form.dataset.disputeId = submissionId;
    form.dataset.disputeUser = submission.userName;

    document.getElementById("update-modal").style.display = "flex";
    showToast('Please correct the timings and submit.');
}

// ✨ Handle thumbs up (verify correct timings)
function handleThumbsUp(submissionId, mosqueId) {
    // Simply call the verification function
    verifySubmission(submissionId, mosqueId);
}

// ✨ Handle thumbs down (incorrect timings - submit correction)
function handleThumbsDown(submissionId, mosqueId) {
    // Check if user is logged in
    if (!state.auth.isLoggedIn) {
        showToast("Please sign in with Google to submit corrected timings");
        showSignInModal();
        return;
    }

    const submissions = state.submissions[mosqueId];
    const submission = submissions.find(s => s.id === submissionId);
    if (!submission) return;

    // Pre-fill the submission modal with these timings for correction
    const form = document.getElementById('update-form');
    form.fajr.value = submission.timings.fajr || '';
    form.zuhr.value = submission.timings.zuhr || '';
    form.asr.value = submission.timings.asr || '';
    form.maghrib.value = submission.timings.maghrib || '';
    form.isha.value = submission.timings.isha || '';
    form.jummah.value = submission.timings.jummah || '';

    // Also include Jummah 2/3 if form has those fields
    if (form.jummah_2) form.jummah_2.value = submission.timings.jummah_2 || '';
    if (form.jummah_3) form.jummah_3.value = submission.timings.jummah_3 || '';

    form.notes.value = `Correction for ${submission.userName}'s submission`;

    // Store dispute context
    form.dataset.disputeId = submissionId;
    form.dataset.disputeUser = submission.userName;

    document.getElementById("update-modal").style.display = "flex";
    showToast('Please correct the timings and submit.');
}

// ✨ Report submission
function reportSubmission(submissionId) {
    const reason = prompt('Why are you reporting this submission?\n\n1. Incorrect timings\n2. Spam\n3. Outdated\n4. Other');
    if (reason) {
        showToast('🚫 Submission reported. Our team will review it.');
    }
}

function updateDetailFavoriteButton() {
    const btn = document.getElementById("detail-favorite-toggle");
    if (!state.selectedMosqueId) return;
    const active = isFavorite(state.selectedMosqueId);
    btn.classList.toggle("active", active);
    btn.innerHTML = `<span>⭐</span><span>${active ? "Favorited" : "Favorite"}</span>`;
}

function computeNextPrayer(timings) {
    const now = new Date();
    const todayStr = now.toISOString().split("T")[0];
    const isFriday = now.getDay() === 5; // Friday is day 5

    // Build prayer list - include Jummah only on Fridays
    const keys = ["fajr", "zuhr", "asr", "maghrib", "isha"];
    if (isFriday && timings.jummah) {
        // Insert Jummah after Fajr but check it alongside Zuhr
        keys.splice(1, 0, "jummah");
    }

    const labels = {
        fajr: "Fajr",
        zuhr: "Zuhr",
        asr: "Asr",
        maghrib: "Maghrib",
        isha: "Isha",
        jummah: "Jummah"
    };

    for (const key of keys) {
        const time = timings[key];
        if (!time) continue;
        const [h, m] = time.split(":");
        const dt = new Date(`${todayStr}T${h.padStart(2, "0")}:${m.padStart(2, "0")}:00`);
        if (dt > now) {
            return { nextPrayerKey: key, nextPrayerName: labels[key], nextPrayerTime: dt };
        }
    }
    return { nextPrayerKey: null, nextPrayerName: null, nextPrayerTime: null };
}

function startCountdown(timings) {
    if (state.countdownIntervalId) {
        clearInterval(state.countdownIntervalId);
    }

    function tick() {
        const res = computeNextPrayer(timings);
        const nameEl = document.getElementById("next-prayer-name");
        const countdownEl = document.getElementById("next-prayer-countdown");

        if (!res.nextPrayerTime) {
            nameEl.textContent = "All prayers completed";
            countdownEl.textContent = "--:--:--";
            return;
        }

        nameEl.textContent = res.nextPrayerName;
        const now = new Date();
        const diffMs = res.nextPrayerTime - now;

        if (diffMs <= 0) {
            countdownEl.textContent = "00:00:00";
            return;
        }

        const totalSeconds = Math.floor(diffMs / 1000);
        const h = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
        const m = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
        const s = String(totalSeconds % 60).padStart(2, "0");
        countdownEl.textContent = `${h}:${m}:${s}`;
    }

    tick();
    state.countdownIntervalId = setInterval(tick, 1000);
}

// ✨ Set a mosque as the default
function setAsDefaultMosque(mosqueId) {
    storage.saveDefaultMosque(mosqueId);
    const mosque = getMosqueById(mosqueId);
    showToast(`✓ ${mosque.name} set as your default mosque`);
    renderFavorites();

    // Auto-load the new default mosque
    selectMosque(mosqueId);
}

function updateProfile() {
    document.getElementById("profile-favorites-count").textContent = state.user.favoriteMosques.length;
    document.getElementById("profile-submissions-count").textContent = state.user.totalSubmissions;
    document.getElementById("profile-reputation").textContent = state.user.reputation;

    // ✨ Update notification badge
    const unreadCount = state.notifications.filter(n => !n.read).length;
    const badge = document.getElementById('notification-badge');
    if (unreadCount > 0) {
        badge.textContent = unreadCount;
        badge.style.display = 'block';
    } else {
        badge.style.display = 'none';
    }

    // ✨ Render badges
    const badgesContainer = document.getElementById('profile-badges');
    badgesContainer.innerHTML = '';

    const badgeIcons = {
        'Top Contributor': '⭐',
        'Early Adopter': '🚀',
        'Verified Helper': '✓',
        'Community Hero': '🏆',
        'Prayer Guardian': '🕌'
    };

    state.user.badges.forEach(badge => {
        const badgeEl = document.createElement('div');
        badgeEl.style.cssText = 'background: rgba(16,185,129,0.15); color: var(--primary); padding: 8px 14px; border-radius: var(--radius-pill); font-size: 13px; font-weight: 600; border: 1px solid rgba(16,185,129,0.3);';
        badgeEl.innerHTML = `${badgeIcons[badge] || '🏅'} ${badge}`;
        badgesContainer.appendChild(badgeEl);
    });

    if (state.user.badges.length === 0) {
        badgesContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 13px;">Earn badges by contributing to the community!</p>';
    }

    // ✨ Render notifications
    const notifContainer = document.getElementById('profile-notifications');
    notifContainer.innerHTML = '';

    const unreadNotifications = state.notifications.filter(n => !n.read);

    if (unreadNotifications.length === 0) {
        notifContainer.innerHTML = '<p style="color: var(--text-muted); font-size: 13px; text-align: center; padding: 20px;">No new notifications</p>';
    } else {
        unreadNotifications.forEach(notif => {
            const notifCard = document.createElement('div');
            notifCard.style.cssText = 'background: rgba(15,23,42,0.95); border: 1px solid rgba(51,65,85,0.8); border-radius: var(--radius-md); padding: 12px; font-size: 13px; cursor: pointer;';
            notifCard.onclick = () => handleNotificationClick(notif.id);

            let icon = '';
            let message = '';

            if (notif.type === 'verification_request') {
                icon = '⏳';
                message = `<strong>${notif.submitterName}</strong> submitted new timings for <strong>${notif.mosqueName}</strong>. Review and verify?`;
            } else if (notif.type === 'timing_update') {
                icon = '🔄';
                message = notif.message;
            } else {
                icon = '🔔';
                message = notif.message || 'New notification';
            }

            notifCard.innerHTML = `
        <div style="display: flex; gap: 10px;">
          <div style="font-size: 24px;">${icon}</div>
          <div style="flex: 1;">
            <div style="color: var(--text-main);">${message}</div>
            <div style="color: var(--text-muted); font-size: 11px; margin-top: 4px;">${formatTimeAgo(notif.createdAt)}</div>
          </div>
          <div style="width: 8px; height: 8px; background: var(--accent); border-radius: 50%; margin-top: 6px;"></div>
        </div>
      `;

            notifCard.appendChild(notifCard);
        });
    }
}

// ✨ Handle notification click
function handleNotificationClick(notifId) {
    const notif = state.notifications.find(n => n.id === notifId);
    if (!notif) return;

    // Mark as read
    notif.read = true;

    // Navigate to appropriate view
    if (notif.type === 'verification_request') {
        selectMosque(notif.mosqueId);
        // Switch to Contributors tab
        document.querySelector('.detail-tab[data-tab="contributors"]').click();
    } else if (notif.type === 'timing_update') {
        selectMosque(notif.mosqueId);
    }

    // Refresh profile to update notifications
    updateProfile();
    showToast('Notification marked as read');
}

function handleSignOut() {
    if (confirm('Are you sure you want to sign out?')) {
        state.auth.isLoggedIn = false;
        state.auth.user = null;
        storage.clearAuth();

        updateAuthUI();
        showToast('Signed out successfully');

        // Return to list view
        switchView('list');
    }
}

function updateAuthUI() {
    const isLoggedIn = state.auth.isLoggedIn;
    const user = state.auth.user;

    // Update header buttons
    document.getElementById('signin-btn').style.display = isLoggedIn ? 'none' : 'flex';
    document.getElementById('user-profile-btn').style.display = isLoggedIn ? 'block' : 'none';

    if (isLoggedIn && user) {
        // Update header profile button
        document.getElementById('user-avatar').src = user.picture;
        document.getElementById('user-name-header').textContent = user.name.split(' ')[0]; // First name only

        // Update profile view
        document.getElementById('profile-user-info').style.display = 'block';
        document.getElementById('profile-guest-prompt').style.display = 'none';
        document.getElementById('profile-content').style.display = 'block';

        document.getElementById('profile-user-avatar').src = user.picture;
        document.getElementById('profile-user-name').textContent = user.name;
        document.getElementById('profile-user-email').textContent = user.email;
        document.getElementById('profile-title').textContent = `${user.name.split(' ')[0]}'s Profile`;
    } else {
        // Guest mode
        document.getElementById('profile-user-info').style.display = 'none';
        document.getElementById('profile-guest-prompt').style.display = 'flex';
        document.getElementById('profile-content').style.display = 'none';
        document.getElementById('profile-title').textContent = 'Your Profile';
    }
}

// Check auth on page load
function initAuth() {
    const savedAuth = storage.getAuth();
    if (savedAuth) {
        state.auth.isLoggedIn = true;
        state.auth.user = savedAuth;
    }
    updateAuthUI();
}

// ========================================
// ✨ ONBOARDING SYSTEM
// ========================================
const onboarding = {
    currentStep: 1,
    totalSteps: 5,
    selectedMosque: null,

    init() {
        if (storage.hasCompletedOnboarding()) {
            return;
        }
        document.getElementById('onboarding-modal').classList.add('show');
        this.updateProgress();
    },

    next() {
        if (this.currentStep < this.totalSteps) {
            document.querySelector(`.onboarding-step[data-step="${this.currentStep}"]`).style.display = 'none';
            this.currentStep++;
            document.querySelector(`.onboarding-step[data-step="${this.currentStep}"]`).style.display = 'block';

            if (this.currentStep === 3) {
                this.loadNearbyMosques();
            }

            this.updateProgress();
        }
    },

    updateProgress() {
        const progress = (this.currentStep / this.totalSteps) * 100;
        document.getElementById('onboarding-progress-fill').style.width = progress + '%';
        document.getElementById('current-step').textContent = this.currentStep;
    },

    async requestLocation() {
        if (navigator.geolocation) {
            try {
                const position = await new Promise((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject);
                });

                state.userLocation = {
                    lat: position.coords.latitude,
                    lng: position.coords.longitude
                };

                showToast('Location detected!');
                this.next();
            } catch (error) {
                showToast('Location access denied');
                this.next();
            }
        } else {
            showToast('Geolocation not supported');
            this.next();
        }
    },

    loadNearbyMosques() {
        const container = document.getElementById('onboarding-mosque-list');
        container.innerHTML = '';

        const mosques = state.mosques
            .sort((a, b) => a.distanceKm - b.distanceKm)
            .slice(0, 5);

        mosques.forEach(mosque => {
            const card = document.createElement('div');
            card.className = 'onboarding-mosque-card';
            card.innerHTML = `
        <strong>${mosque.name}</strong>
        <div style="font-size: 12px; color: var(--text-muted); margin-top: 4px;">
          ${mosque.address}, ${mosque.city} · ${formatDistance(mosque.distanceKm)}
        </div>
      `;
            card.onclick = () => this.selectMosque(mosque, card);
            container.appendChild(card);
        });
    },

    selectMosque(mosque, cardElement) {
        this.selectedMosque = mosque.id;

        document.querySelectorAll('.onboarding-mosque-card').forEach(card => {
            card.classList.remove('selected');
        });
        cardElement.classList.add('selected');

        setTimeout(() => this.next(), 500);
    },

    complete() {
        const reminders = {
            fajr: {
                enabled: document.querySelector('input[name="reminder-fajr"]')?.checked || false,
                minutes: parseInt(document.querySelector('input[name="reminder-fajr"]')?.closest('.reminder-checkbox')?.querySelector('.reminder-offset')?.value || 15)
            },
            maghrib: {
                enabled: document.querySelector('input[name="reminder-maghrib"]')?.checked || false,
                minutes: parseInt(document.querySelector('input[name="reminder-maghrib"]')?.closest('.reminder-checkbox')?.querySelector('.reminder-offset')?.value || 10)
            },
            isha: {
                enabled: document.querySelector('input[name="reminder-isha"]')?.checked || false,
                minutes: parseInt(document.querySelector('input[name="reminder-isha"]')?.closest('.reminder-checkbox')?.querySelector('.reminder-offset')?.value || 15)
            },
            jummah: {
                enabled: document.querySelector('input[name="reminder-jummah"]')?.checked || false,
                minutes: parseInt(document.querySelector('input[name="reminder-jummah"]')?.closest('.reminder-checkbox')?.querySelector('.reminder-offset')?.value || 30)
            }
        };
        localStorage.setItem('reminder_preferences', JSON.stringify(reminders));
        this.next();
    },

    finish() {
        storage.markOnboardingComplete();

        if (this.selectedMosque) {
            storage.saveDefaultMosque(this.selectedMosque);
            state.selectedMosqueId = this.selectedMosque;
        }

        document.getElementById('onboarding-modal').classList.remove('show');
        showToast('Welcome to Jamat! 🎉');

        if (this.selectedMosque) {
            setTimeout(() => {
                selectMosque(this.selectedMosque);
            }, 300);
        }
    },

    skip() {
        if (confirm('Skip onboarding? You can always access settings later.')) {
            storage.markOnboardingComplete();
            document.getElementById('onboarding-modal').classList.remove('show');
        }
    }
};

// ========================================
// EVENT LISTENERS & INIT
// ========================================

// Map buttons
document.getElementById("btn-my-location").addEventListener("click", () => {
    if (state.userLocation) {
        state.map.setCenter(state.userLocation);
        state.map.setZoom(15);
        showToast("Centered on your location");
    } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            (position) => {
                const pos = { lat: position.coords.latitude, lng: position.coords.longitude };
                state.userLocation = pos;
                state.map.setCenter(pos);
                state.map.setZoom(15);
                showToast("Location detected");
            },
            () => showToast("Unable to get your location")
        );
    } else {
        showToast("Geolocation not supported");
    }
});

document.getElementById("btn-add-mosque").addEventListener("click", () => {
    showToast("Feature coming soon - you'll be able to add new mosques");
});

// Detail buttons
document.getElementById("detail-favorite-toggle").addEventListener("click", () => {
    if (state.selectedMosqueId) {
        toggleFavorite(state.selectedMosqueId);
    }
});

document.getElementById("detail-default-toggle").addEventListener("click", () => {
    if (state.selectedMosqueId) {
        toggleDefaultMosque(state.selectedMosqueId);
    }
});

document.getElementById("btn-view-map").addEventListener("click", () => {
    const mosque = getMosqueById(state.selectedMosqueId);
    if (!mosque) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${mosque.coordinates.lat},${mosque.coordinates.lng}`;
    window.open(url, "_blank");
});

document.getElementById("btn-directions").addEventListener("click", () => {
    const mosque = getMosqueById(state.selectedMosqueId);
    if (!mosque) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${mosque.coordinates.lat},${mosque.coordinates.lng}`;
    window.open(url, "_blank");
});

document.getElementById("btn-update-timings").addEventListener("click", () => {
    // ✨ Require login to submit timings
    if (!state.auth.isLoggedIn) {
        showToast("Please sign in to submit timing updates");
        showSignInModal();
        return;
    }

    if (!state.selectedMosqueId) {
        showToast("Please select a mosque first");
        return;
    }
    const mosque = getMosqueById(state.selectedMosqueId);
    const form = document.getElementById("update-form");
    form.fajr.value = mosque.defaultJamaatTimings.fajr;
    form.zuhr.value = mosque.defaultJamaatTimings.zuhr;
    form.asr.value = mosque.defaultJamaatTimings.asr;
    form.maghrib.value = mosque.defaultJamaatTimings.maghrib;
    form.isha.value = mosque.defaultJamaatTimings.isha;
    form.jummah.value = mosque.defaultJamaatTimings.jummah || '';
    form.notes.value = "";
    form.verified.checked = false;
    document.getElementById("update-modal").style.display = "flex";
});

// Update form
document.getElementById("btn-close-modal").addEventListener("click", () => {
    document.getElementById("update-modal").style.display = "none";
});

document.getElementById("update-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const mosqueId = state.selectedMosqueId;
    if (!mosqueId) return;

    const form = e.target;
    const timings = {
        fajr: form.fajr.value,
        zuhr: form.zuhr.value,
        asr: form.asr.value,
        maghrib: form.maghrib.value,
        isha: form.isha.value,
        jummah: form.jummah.value || '',
        jummah_2: form.jummah_2.value || '',
        jummah_3: form.jummah_3.value || ''
    };

    // ✨ Create new submission
    const newSubmission = {
        id: 'sub' + Date.now(),
        userId: state.auth.user.id,
        userName: state.auth.user.name,
        userReputation: state.user.reputation,
        isTopContributor: state.userContributions[mosqueId]?.isTopContributor || false,
        submittedAt: new Date().toISOString(),
        timings: timings,
        notes: form.notes.value || '',
        verified: false,
        verifiedBy: 0,
        verifications: [], // ✨ Track who verified
        status: 'pending_verification'
    };

    // Add to submissions
    if (!state.submissions[mosqueId]) {
        state.submissions[mosqueId] = [];
    }
    state.submissions[mosqueId].unshift(newSubmission); // Add to beginning

    // ✨ Notify top contributors for verification
    const mosque = getMosqueById(mosqueId);
    if (mosque) {
        // Check if this is a dispute
        const disputeId = form.dataset.disputeId;

        if (disputeId) {
            state.notifications.push({
                id: 'notif' + Date.now(),
                type: 'timing_update',
                mosqueId: mosqueId,
                mosqueName: mosque.name,
                message: `<strong>${state.auth.user.name}</strong> suggested a correction to your timings for <strong>${mosque.name}</strong>.`,
                createdAt: new Date().toISOString(),
                read: false
            });
            // Clear dispute context
            delete form.dataset.disputeId;
            delete form.dataset.disputeUser;
        } else {
            state.notifications.push({
                id: 'notif' + Date.now(),
                type: 'verification_request',
                mosqueId: mosqueId,
                mosqueName: mosque.name,
                submissionId: newSubmission.id,
                submitterName: state.auth.user.name,
                createdAt: new Date().toISOString(),
                read: false
            });
        }
    }

    state.user.totalSubmissions += 1;
    state.user.reputation += 10;

    // Refresh the submissions display
    renderContributors(mosqueId);

    showToast("Timings submitted! Waiting for community verification. +10 reputation");
    document.getElementById("update-modal").style.display = "none";
    updateProfile();

    // Switch to Contributors tab to show the new submission
    setTimeout(() => {
        document.querySelector('.detail-tab[data-tab="contributors"]').click();
    }, 500);
});

// ✨ Debounce utility
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ✨ Intelligent Search Handler
const handleSearch = debounce((query) => {
    query = query.toLowerCase().trim();

    if (!query) {
        renderMosqueList(); // Show default list
        return;
    }

    const allMosques = state.mosques;
    const favorites = state.user.favoriteMosques;

    // 1. Favorites matching query
    const matchedFavorites = allMosques.filter(m =>
        favorites.includes(m.id) &&
        (m.name.toLowerCase().includes(query) || m.address.toLowerCase().includes(query) || m.city.toLowerCase().includes(query))
    );

    // 2. Nearby matching query (excluding favorites)
    const nearbyMatches = allMosques.filter(m =>
        !favorites.includes(m.id) &&
        m.distanceKm <= 5 &&
        (m.name.toLowerCase().includes(query) || m.address.toLowerCase().includes(query) || m.city.toLowerCase().includes(query))
    );

    // 3. Other results (further away, excluding favorites)
    const otherMatches = allMosques.filter(m =>
        !favorites.includes(m.id) &&
        m.distanceKm > 5 &&
        (m.name.toLowerCase().includes(query) || m.address.toLowerCase().includes(query) || m.city.toLowerCase().includes(query))
    );

    // Construct categorized results
    const categorizedResults = [];

    if (matchedFavorites.length > 0) {
        categorizedResults.push({ title: "⭐ Your Favorites", items: matchedFavorites });
    }

    if (nearbyMatches.length > 0) {
        categorizedResults.push({ title: "📍 Nearby", items: nearbyMatches });
    }

    if (otherMatches.length > 0) {
        categorizedResults.push({ title: "🌍 Other Results", items: otherMatches });
    }

    // If no matches found
    if (categorizedResults.length === 0) {
        renderMosqueList([]); // Will show "No mosques found"
    } else {
        renderMosqueList(categorizedResults);
    }
}, 300);

// Navigation
document.querySelectorAll(".nav-btn").forEach(btn => {
    btn.addEventListener("click", () => {
        switchView(btn.dataset.view);
    });
});

// List search and filter
document.getElementById("list-search-input").addEventListener("input", (e) => handleSearch(e.target.value));
document.getElementById("filter-select").addEventListener("change", () => renderMosqueList());

// ✨ Amenities filter
document.querySelectorAll('#amenities-filter .chip-outline').forEach(chip => {
    chip.addEventListener('click', () => {
        chip.classList.toggle('active');
        renderMosqueList();
    });
});

// Onboarding skip button
document.getElementById("onboarding-skip").addEventListener("click", () => {
    onboarding.skip();
});

// Initialize
// Initialize
document.addEventListener("DOMContentLoaded", () => {
    console.log("🚀 App initializing...");

    try {
        initAuth(); // ✨ Check if user is already logged in
        console.log("✓ Auth initialized");
    } catch (e) {
        console.error("Auth init failed:", e);
    }

    try {
        initTabs();
        console.log("✓ Tabs initialized");
    } catch (e) {
        console.error("Tabs init failed:", e);
    }

    try {
        renderMosqueList();
        console.log("✓ Mosque list rendered");
    } catch (e) {
        console.error("Mosque list render failed:", e);
    }

    try {
        updateProfile();
        console.log("✓ Profile updated");
    } catch (e) {
        console.error("Profile update failed:", e);
    }

    // Load default mosque if set
    try {
        const defaultMosqueId = storage.getDefaultMosque();
        if (defaultMosqueId && storage.hasCompletedOnboarding()) {
            setTimeout(() => {
                console.log(`Loading default mosque: ${defaultMosqueId}`);
                selectMosque(defaultMosqueId);
            }, 1000);
        }
    } catch (e) {
        console.error("Default mosque load failed:", e);
    }

    // Show onboarding for first-time users
    if (!storage.hasCompletedOnboarding()) {
        // Small delay to ensure styles are loaded
        setTimeout(() => {
            onboarding.init();
        }, 100);
    } else {
        // ✨ Force render if list is empty (Fallback 1)
        setTimeout(() => {
            const list = document.getElementById("mosque-list");
            if (!list || list.innerHTML.trim() === "") {
                console.warn("⚠️ Mosque list empty after 500ms. Forcing re-render...");
                try {
                    renderMosqueList();
                    document.getElementById("location-status").textContent = "Loaded (Fallback)";
                } catch (e) {
                    console.error("Fallback render failed:", e);
                }
            }
        }, 500);

        // ✨ Force render if list is empty (Fallback 2)
        setTimeout(() => {
            const list = document.getElementById("mosque-list");
            if (!list || list.innerHTML.trim() === "") {
                console.warn("⚠️ Mosque list still empty after 2s. Forcing re-render...");
                renderMosqueList();
            }
        }, 2000);
    }
});
