import vlc
import sys
import time
from PyQt6.QtCore import QObject, QTimer, pyqtSignal

class AudioPlayer(QObject):
    """
    Advanced Audio Engine with Support for Crossfade (2-seconds).
    """
    def __init__(self):
        super().__init__()
        options = ["--aout=directx"] if sys.platform.startswith('win') else []
        self.instance = vlc.Instance(*options)
        
        # Two players for crossfading
        self.player_a = self.instance.media_player_new()
        self.player_b = self.instance.media_player_new()
        
        self.active_player = self.player_a
        self.back_player = self.player_b
        
        self.fade_timer = QTimer()
        self.fade_timer.setInterval(50) # Update every 50ms for smoothness
        self.fade_timer.timeout.connect(self._handle_fade)
        
        self.target_volume = 100
        self.fade_step = 2 # Change volume by 2 every 50ms (2s total for 100)

    def play_url(self, url, crossfade=True):
        """
        Starts playing a new URL, optionally with a crossfade from current track.
        """
        try:
            # Prepare the 'next' player
            media = self.instance.media_new(url)
            self.back_player.set_media(media)
            
            if crossfade and self.is_playing():
                # Start Crossfade sequence
                self.back_player.audio_set_volume(0)
                self.back_player.play()
                self.fade_timer.start()
            else:
                # Instant start
                self.active_player.stop()
                self.active_player.set_media(media)
                self.active_player.audio_set_volume(100)
                self.active_player.play()
                
            return True
        except Exception as e:
            print(f"Error in AudioPlayer.play_url: {e}")
            return False

    def _handle_fade(self):
        # Decrease active, increase back
        curr_active_vol = self.active_player.audio_get_volume()
        curr_back_vol = self.back_player.audio_get_volume()
        
        new_active = max(0, curr_active_vol - self.fade_step)
        new_back = min(100, curr_back_vol + self.fade_step)
        
        self.active_player.audio_set_volume(new_active)
        self.back_player.audio_set_volume(new_back)
        
        if new_active == 0 and new_back == 100:
            self.fade_timer.stop()
            self.active_player.stop()
            
            # Swap roles
            self.active_player, self.back_player = self.back_player, self.active_player
            print("DEBUG: Crossfade complete.")

    def pause(self):
        self.active_player.pause()

    def stop(self):
        self.fade_timer.stop()
        self.active_player.stop()
        self.back_player.stop()

    def set_volume(self, volume):
        self.active_player.audio_set_volume(volume)

    def get_time(self):
        return self.active_player.get_time()

    def set_time(self, position):
        self.active_player.set_time(position)

    def get_length(self):
        return self.active_player.get_length()

    def is_playing(self):
        # Either one playing means audio is outputting
        return self.active_player.is_playing() or self.back_player.is_playing()
