import yt_dlp
import datetime
import time

class YDLLogger:
    def debug(self, msg): pass
    def warning(self, msg): pass
    def error(self, msg): print(f"YT Error: {msg}")

class YouTubeClient:
    def __init__(self):
        # Base options optimized for speed
        self.ydl_opts_base = {
            'format': 'bestaudio/best',
            'noplaylist': True,
            'quiet': True,
            'extract_flat': True,
            'ignoreerrors': True,
            'no_warnings': True,
            'nocheckcertificate': True,
            'logger': YDLLogger(),
        }
        
        self.ydl_opts_stream = {
            'format': 'bestaudio/best',
            'noplaylist': True,
            'quiet': True,
            'no_warnings': True,
            'ignoreerrors': True,
            'nocheckcertificate': True,
            'extract_flat': False,
            'logger': YDLLogger(),
        }

        # Memory Cache: { "query_str": (results, timestamp) }
        self._cache = {}
        self._cache_expiry = 600 # 10 minutes

    def search(self, query, limit=15, is_trending=False):
        """
        Searches YouTube and prioritizes MUSICAL content.
        Uses flat extraction for maximum speed and applies soft heuristics for filtering.
        """
        cache_key = f"{query}_{limit}_{is_trending}"
        curr_time = time.time()

        if cache_key in self._cache:
            results, timestamp = self._cache[cache_key]
            if curr_time - timestamp < self._cache_expiry:
                print(f"DEBUG: Cache HIT for '{query}'")
                return results

        results = []
        # Strictly prioritize single tracks - exclude mashups, jukeboxes, nonstop mixes
        refined_query = f"{query} -mashup -jukebox -nonstop -collection -\"full album\""
        if not any(k in query.lower() for k in ["song", "music", "audio", "video"]):
            refined_query = f"{refined_query} song"
            
        opts = self.ydl_opts_base.copy()
        opts['extract_flat'] = True 
        
        if is_trending:
            thirty_days_ago = (datetime.datetime.now() - datetime.timedelta(days=30)).strftime('%Y%m%d')
            opts['daterange'] = yt_dlp.utils.DateRange(start=thirty_days_ago)

        try:
            print(f"DEBUG: Fetching SINGLE tracks for '{refined_query}'...")
            with yt_dlp.YoutubeDL(opts) as ydl:
                # Higher multiplier to ensure we have enough results after filtering
                search_n = limit + 40 if limit > 20 else limit + 20
                info = ydl.extract_info(f"ytsearch{search_n}:{refined_query}", download=False)
                
                if info and 'entries' in info:
                    for entry in info['entries']:
                        if not entry: continue
                        
                        title = entry.get('title', '').lower()
                        duration = entry.get('duration')
                        
                        # Strict Single Track Filter:
                        # 1. Must have duration (if provided)
                        # 2. Must be between 20s and 600s (10 min)
                        # 3. Double check title for negative keywords
                        if isinstance(duration, (int, float)):
                            if duration < 20 or duration > 620: continue 
                        
                        # Exclude obvious non-single-track keywords
                        exclude = ["full movie", "news", "interview", "documentary", "jukebox", "mashup", "nonstop", "full album", "compilation"]
                        if any(x in title for x in exclude): continue

                        results.append({
                            'id': entry.get('id'),
                            'title': entry.get('title', 'Unknown'),
                            'url': entry.get('url') if entry.get('url') else f"https://www.youtube.com/watch?v={entry.get('id')}",
                            'duration': entry.get('duration'),
                            'thumbnail': entry.get('thumbnail') or f"https://img.youtube.com/vi/{entry.get('id')}/mqdefault.jpg",
                            'is_artist': False,
                            'uploader': entry.get('uploader')
                        })
                        if len(results) >= limit: break
            
            if results:
                self._cache[cache_key] = (results, curr_time)
                if len(self._cache) > 100:
                    sorted_keys = sorted(self._cache.keys(), key=lambda k: self._cache[k][1])
                    for k in sorted_keys[:20]: del self._cache[k]

        except Exception as e:
            print(f"Error searching: {e}")
            
        print(f"DEBUG: Returning {len(results)} search results.")
        return results

    def get_stream_url(self, video_url):
        try:
            with yt_dlp.YoutubeDL(self.ydl_opts_stream) as ydl:
                info = ydl.extract_info(video_url, download=False)
                return info.get('url'), info.get('title')
        except Exception as e:
            print(f"Error getting stream: {e}")
            return None, None
