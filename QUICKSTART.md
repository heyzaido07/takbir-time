# Quick Start Guide

Get up and running in 5 minutes!

## Step 1: Get Google Maps API Key

1. Visit [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Name it "Jamat App" and click "Create"
4. In the search bar, type "Maps JavaScript API" and enable it
5. Search for "Places API" and enable it
6. Go to "Credentials" → "Create Credentials" → "API Key"
7. Copy your API key (starts with `AIza...`)

## Step 2: Add API Key to the App

1. Open `index.html` in a text editor
2. Press `Ctrl+F` (or `Cmd+F` on Mac) and search for: `YOUR_API_KEY`
3. Replace `YOUR_API_KEY` with your actual API key
4. Save the file

Example:
```html
<!-- Before -->
<script src="https://maps.googleapis.com/maps/api/js?key=YOUR_API_KEY&libraries=places&callback=initMap" async defer></script>

<!-- After -->
<script src="https://maps.googleapis.com/maps/api/js?key=AIzaSyDXXXXXXXXXXX&libraries=places&callback=initMap" async defer></script>
```

## Step 3: Open the App

Simply double-click `index.html` to open it in your browser!

That's it! 🎉

## What You Can Do

- 🗺️ **View mosques on the map** - Click green markers to see details
- 📋 **Browse mosque list** - Switch to List tab
- ⭐ **Save favorites** - Click the star icon on any mosque
- 🕌 **View prayer times** - See jamaat timings and live countdown
- ✏️ **Update timings** - Help the community by submitting updates

## Troubleshooting

### Map not showing?
- Make sure you added your API key correctly
- Check browser console for errors (F12 → Console tab)
- Verify your API key is enabled for Maps JavaScript API and Places API

### Location not detected?
- Click "Allow" when browser asks for location permission
- If blocked, click the 🔒 icon in address bar and allow location access

### Mosques not appearing?
- The demo includes 3 sample mosques in Lahore
- You can add more by editing the `state.mosques` array in `index.html`
- See README.md for details on adding mosques

## Need Help?

Check the full [README.md](README.md) for detailed documentation!
