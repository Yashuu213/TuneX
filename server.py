import sys
import os
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

# Removed parent directory logic for Vercel compatibility
try:
    from core.youtube_client import YouTubeClient
    from core.lyrics_engine import LyricsEngine
    from core.storage import StorageManager
    print("✅ Successfully imported Self-Contained Core Modules!")
except ImportError as e:
    print(f"❌ Error importing core modules: {e}")
    # Fallback to local import if needed
    try:
        from .core.youtube_client import YouTubeClient
        from .core.lyrics_engine import LyricsEngine
        from .core.storage import StorageManager
    except Exception as inner_e:
        print(f"❌ Final fallback failed: {inner_e}")
        sys.exit(1)

# Initialize Flask with the current directory as static folder
app = Flask(__name__, static_folder=".", static_url_path="")
CORS(app)  # Enable CORS for all routes

# --- STATIC CONTENT ROUTES ---
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def send_static(path):
    return send_from_directory('.', path)

# Initialize original logic classes
yt_client = YouTubeClient()
lyrics_engine = LyricsEngine()
storage = StorageManager()
# In-memory cache for artist thumbnails
ARTIST_CACHE = {}

@app.route('/api/proxy_image')
def proxy_image():
    url = request.args.get('url', '')
    if not url: return jsonify({"error": "No URL"}), 400
    
    try:
        import requests
        from flask import send_file, make_response
        import io

        # Bypass browser CORS by fetching server-side
        resp = requests.get(url, stream=True, timeout=10)
        if resp.status_code == 200:
            # Create response and add cache headers
            response = make_response(send_file(io.BytesIO(resp.content), mimetype=resp.headers.get('Content-Type', 'image/jpeg')))
            response.headers['Cache-Control'] = 'public, max-age=86400' # Cache for 24 hours
            return response
    except Exception as e:
        print(f"Proxy Error for {url}: {e}")
    
    return jsonify({"error": "Failed to proxy"}), 500

@app.route('/api/artist_avatar', methods=['GET'])
def get_artist_avatar():
    name = request.args.get('q', '')
    if not name: return jsonify({"url": ""})
    
    if name in ARTIST_CACHE: return jsonify({"url": ARTIST_CACHE[name]})

    import yt_dlp
    # Attempt multi-layered discovery for 100% image success
    search_queries = [
        f"ytsearch1:{name} topic channel",
        f"ytsearch1:{name} official artist channel",
        f"ytsearch1:{name} channel"
    ]
    
    opts = {'extract_flat': True, 'quiet': True, 'skip_download': True}
    
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            for query in search_queries:
                info = ydl.extract_info(query, download=False)
                if info and 'entries' in info and len(info['entries']) > 0:
                    entry = info['entries'][0]
                    # Try to get the channel avatar first, then any available thumbnail
                    thumb = entry.get('channel_thumbnail') or entry.get('thumbnail')
                    if thumb:
                        proxied = f"/api/proxy_image?url={thumb}"
                        ARTIST_CACHE[name] = proxied
                        return jsonify({"url": proxied})
                        
            # Absolute fallback: Just use the first song result thumbnail
            raw_results = yt_client.search(name, limit=1)
            if raw_results and len(raw_results) > 0:
                thumb = raw_results[0].get('thumbnail')
                proxied = f"/api/proxy_image?url={thumb}"
                ARTIST_CACHE[name] = proxied
                return jsonify({"url": proxied})

    except Exception as e:
        print(f"Final Avatar Error for {name}: {e}")
        
    return jsonify({"url": ""})

# --- API ROUTES ---
@app.route('/api/search', methods=['GET'])
def search():
    query = request.args.get('q', '')
    is_trending = request.args.get('trending', 'false').lower() == 'true'
    is_home = request.args.get('home', 'false').lower() == 'true'
    
    if not query and not is_trending:
        return jsonify([])

    # 1. OPTIMIZATION: We removed 'home_cache' to ensure freshness on every refresh.
    # 2. Track search terms for recommendations later
    if query:
        storage.add_search_term(query)

    # 3. Perform the actual search with a LARGER pool (60)
    search_limit = 60 if is_home else 30
    results = yt_client.search(query, limit=search_limit, is_trending=is_trending)
    
    # 4. RANDOM SAMPLE: Pick 15 random items from the 60 found to ensure variety
    if is_home and results and len(results) > 15:
        import random
        results = random.sample(results, 15)
        
    return jsonify(results)

@app.route('/api/recommendations', methods=['GET'])
def recommendations():
    is_home = request.args.get('home', 'false').lower() == 'true'
    
    # Cache removed for freshness
    history = storage.get_history()
    prefs = storage.get_preferences()
    last_searches = prefs.get('last_searches', [])
    
    # Analyze Top Artists
    from collections import Counter
    artists = [track.get('uploader', 'Unknown') for track in history if track.get('uploader')]
    top_artists = [a for a, c in Counter(artists).most_common(2)]
    
    # Build Seed Query
    seed_parts = []
    if top_artists: seed_parts.append(f"songs like {' and '.join(top_artists)}")
    if last_searches: seed_parts.append(last_searches[0])
    
    seed_query = " ".join(seed_parts) if seed_parts else "latest bollywood hits 2026 trending"
    
    # Fetch Recommendations with a wide pool (40) and sample 15
    results = yt_client.search(seed_query, limit=40)
    
    if is_home and results and len(results) > 15:
        import random
        results = random.sample(results, 15)
        
    return jsonify(results)

@app.route('/api/lyrics', methods=['GET'])
def get_lyrics():
    artist = request.args.get('artist', '')
    track = request.args.get('track', '')
    # Re-using your exact desktop lyrics logic
    lyrics = lyrics_engine.fetch_lyrics(artist, track)
    return jsonify({"lyrics": lyrics})

@app.route('/api/stream', methods=['GET'])
def get_stream():
    video_url = request.args.get('url', '')
    if not video_url:
        return jsonify({"error": "No URL provided"}), 400
    
    # Re-using your exact desktop streaming extractor
    stream_url, title = yt_client.get_stream_url(video_url)
    return jsonify({"stream_url": stream_url, "title": title})

@app.route('/api/history', methods=['GET', 'POST'])
def handle_history():
    if request.method == 'POST':
        track = request.json
        storage.add_to_history(track)
        return jsonify({"status": "success"})
    else:
        # Re-using your exact desktop data.json persistence
        return jsonify(storage.get_history())

@app.route('/api/playlists', methods=['GET', 'POST'])
def handle_playlists():
    if request.method == 'POST':
        data = request.json
        success = storage.add_to_playlist(data.get('name'), data.get('track'))
        return jsonify({"status": "success", "added": success})
    else:
        return jsonify(storage.get_playlists())

@app.route('/api/playlists/create', methods=['POST'])
def create_playlist():
    data = request.json
    name = data.get('name')
    if not name: return jsonify({"error": "No name"}), 400
    success = storage.create_playlist(name)
    return jsonify({"status": "success", "created": success})

@app.route('/api/playlists/delete', methods=['POST'])
def delete_playlist():
    name = request.json.get('name')
    success = storage.delete_playlist(name)
    return jsonify({"status": "success", "deleted": success})

if __name__ == '__main__':
    print("⚡ Pikachu Web Backend (Full-Stack) starting...")
    print("🔗 Hosting at: http://localhost:5001")
    app.run(host='0.0.0.0', port=5001, debug=True)
