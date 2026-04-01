import json
import os

DATA_FILE = "data.json"

class StorageManager:
    def __init__(self):
        self.data = {
            "history": [],
            "playlists": {},
            "preferences": {
                "languages": ["Hindi"], 
                "last_searches": []
            },
            "home_cache": {} # NEW: Persistent Home Dashboard Cache
        }
        self.load_data()

    def load_data(self):
        if os.path.exists(DATA_FILE):
            try:
                with open(DATA_FILE, 'r') as f:
                    saved = json.load(f)
                    # Merge to ensure new keys (preferences) exist
                    self.data.update(saved)
            except:
                pass

    def save_data(self):
        try:
            with open(DATA_FILE, 'w') as f:
                json.dump(self.data, f, indent=4)
        except Exception as e:
            print(f"Error saving data: {e}")

    def add_to_history(self, video):
        # Avoid duplicates at the top
        history = self.data["history"]
        history = [v for v in history if v['id'] != video['id']]
        history.insert(0, video)
        if len(history) > 50: history.pop()
        self.data["history"] = history
        self.save_data()

    def get_history(self):
        return self.data["history"]

    def create_playlist(self, name):
        if name not in self.data["playlists"]:
            self.data["playlists"][name] = []; self.save_data(); return True
        return False

    def add_to_playlist(self, playlist_name, video):
        if playlist_name in self.data["playlists"]:
            playlist = self.data["playlists"][playlist_name]
            if not any(v['id'] == video['id'] for v in playlist):
                playlist.append(video); self.save_data(); return True
        return False

    def get_playlists(self):
        return self.data["playlists"]

    def delete_playlist(self, name):
        if name in self.data["playlists"]:
            del self.data["playlists"][name]
            self.save_data(); return True
        return False

    def remove_from_playlist(self, playlist_name, video_id):
        if playlist_name in self.data["playlists"]:
            self.data["playlists"][playlist_name] = [v for v in self.data["playlists"][playlist_name] if v['id'] != video_id]
            self.save_data()
            
    def get_preferences(self):
        return self.data.get("preferences", {"languages": ["Hindi"], "last_searches": []})
        
    def update_languages(self, languages):
        self.data["preferences"]["languages"] = languages
        self.save_data()
        
    def add_search_term(self, term):
        searches = self.data["preferences"].get("last_searches", [])
        if term in searches: searches.remove(term)
        searches.insert(0, term)
        self.data["preferences"]["last_searches"] = searches[:5] # Keep last 5
        self.save_data()

    def save_home_cache(self, context, results):
        if not self.data.get("home_cache"): self.data["home_cache"] = {}
        self.data["home_cache"][context] = results
        self.save_data()

    def get_home_cache(self, context):
        return self.data.get("home_cache", {}).get(context, [])
