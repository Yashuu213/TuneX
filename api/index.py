from flask import Flask, request, jsonify
from flask_cors import CORS
import sys
import os

# Ensure core modules are importable from the current api directory
sys.path.append(os.path.join(os.path.dirname(__file__), 'core'))

try:
    from youtube_client import YouTubeClient
    from lyrics_engine import LyricsEngine
    from storage import StorageManager
    print("✅ Successfully imported Core Modules in API!")
except ImportError as e:
    print(f"❌ Error importing core modules: {e}")
    sys.exit(1)

app = Flask(__name__)
CORS(app)

# Initialize logic classes
yt_client = YouTubeClient()
lyrics_engine = LyricsEngine()
storage = StorageManager() # This will now be primarily for non-persistent caching

# In-memory artistic cache (only lasts for function lifespan on Vercel)
ARTIST_CACHE = {}

@app.route('/api/proxy_image')
def proxy_image():
    url = request.args.get('url', '')
    if not url: return jsonify({"error": "No URL"}), 400
    
    try:
        import requests
        from flask import send_file, make_response
        import io

        resp = requests.get(url, stream=True, timeout=10)
        if resp.status_code == 200:
            response = make_response(send_file(io.BytesIO(resp.content), mimetype=resp.headers.get('Content-Type', 'image/jpeg')))
            response.headers['Cache-Control'] = 'public, max-age=86400'
            return response
    except Exception as e:
        print(f"Proxy Error: {e}")
    
    return jsonify({"error": "Failed to proxy"}), 500

@app.route('/api/artist_avatar', methods=['GET'])
def get_artist_avatar():
    name = request.args.get('q', '')
    if not name: return jsonify({"url": ""})
    if name in ARTIST_CACHE: return jsonify({"url": ARTIST_CACHE[name]})

    import yt_dlp
    search_queries = [f"ytsearch1:{name} official artist channel", f"ytsearch1:{name} channel"]
    opts = {'extract_flat': True, 'quiet': True, 'skip_download': True}
    
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            for query in search_queries:
                info = ydl.extract_info(query, download=False)
                if info and 'entries' in info and len(info['entries']) > 0:
                    entry = info['entries'][0]
                    thumb = entry.get('channel_thumbnail') or entry.get('thumbnail')
                    if thumb:
                        proxied = f"/api/proxy_image?url={thumb}"
                        ARTIST_CACHE[name] = proxied
                        return jsonify({"url": proxied})
    except: pass
    return jsonify({"url": ""})

@app.route('/api/search', methods=['GET'])
def search():
    query = request.args.get('q', '')
    is_trending = request.args.get('trending', 'false').lower() == 'true'
    is_home = request.args.get('home', 'false').lower() == 'true'
    
    if not query and not is_trending: return jsonify([])

    # Home caching logic (now transient on Vercel, but useful for sequential rapid calls)
    if is_home:
        cached = storage.get_home_cache(query or "trending_hits")
        if cached: return jsonify(cached)

    results = yt_client.search(query, limit=50, is_trending=is_trending)
    
    if is_home:
        storage.save_home_cache(query or "trending_hits", results)
        
    return jsonify(results)

@app.route('/api/recommendations', methods=['GET'])
def recommendations():
    # Simple recommendation engine based on popular hits if no persistent history is available on server
    query = "latest bollywood hits 2026 trending"
    results = yt_client.search(query, limit=30)
    return jsonify(results)

@app.route('/api/lyrics', methods=['GET'])
def get_lyrics():
    artist = request.args.get('artist', '')
    track = request.args.get('track', '')
    lyrics = lyrics_engine.fetch_lyrics(artist, track)
    return jsonify({"lyrics": lyrics})

@app.route('/api/stream', methods=['GET'])
def get_stream():
    video_url = request.args.get('url', '')
    stream_url, title = yt_client.get_stream_url(video_url)
    return jsonify({"stream_url": stream_url, "title": title})

# Note: /api/history and /api/playlists are handled client-side now for Vercel compatibility.

if __name__ == '__main__':
    app.run(debug=True)
