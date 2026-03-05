import { SFXLIST as sfxobj } from "../data/sfxlist.js";
import { songsobj } from "../data/data.js";
import { Game } from "../main.js";

export class Sounds {
    sfx = {};
    sfxBuffers = {};
    sfxPlaying = {};
    songs = [];
    songNames = [];
    curSongIdx = 0;
    elSongProgress = document.getElementById("songProgress");
    elSongText = document.getElementById("songText");

    lowpassfilter;
    audioContext;
    sfxGain;

    /**
     *
     * @param {string} audioName
     * Name of audio as specified in sfxlist.json
     * @param {Boolean} replace
     * If true, stops currently playing audio and starts new one
     * If false, skips if audio is already playing
     */
    playSound(audioName, replace = true, silent = false) {
        if (this.audioContext && this.sfxBuffers[audioName]) {
            if (this.audioContext.state === "suspended") this.audioContext.resume();
            if (!replace && this.sfxPlaying[audioName]) return;
            try {
                const source = this.audioContext.createBufferSource();
                source.buffer = this.sfxBuffers[audioName];
                const gain = this.audioContext.createGain();
                gain.gain.value = silent ? 0 : Game.settings.volume.sfxLevel / 100;
                source.connect(gain);
                gain.connect(this.sfxGain);
                this.sfxPlaying[audioName] = true;
                source.onended = () => { this.sfxPlaying[audioName] = false; };
                source.start(0);
            } catch (error) {}
            return;
        }
        // fallback to HTMLAudioElement
        if (this.sfx[audioName] == undefined) return;
        this.sfx[audioName].muted = silent;
        this.sfx[audioName].volume = Game.settings.volume.sfxLevel / 100;
        if (!replace && !this.sfx[audioName].ended && this.sfx[audioName].currentTime != 0) return;
        this.sfx[audioName].currentTime = 0;
        try {
            this.sfx[audioName].play();
        } catch (error) {}
    }

    startSong() {
        if (this.audioContext && this.audioContext.state === "suspended") this.audioContext.resume();
        this.elSongText.textContent = `Now Playing ${this.songNames[this.curSongIdx]}`;
        this.songs[this.curSongIdx].onended = () => {
            this.endSong();
            this.startSong();
        };
        this.musicGain.gain.value = Game.settings.volume.audioLevel / 100;
        this.songs[this.curSongIdx].play();
    }

    endSong() {
        this.songs[this.curSongIdx].pause();
        this.songs[this.curSongIdx].currentTime = 0;
        this.songs[this.curSongIdx].onended = () => { };
        this.curSongIdx = (this.curSongIdx + 1) % this.songs.length;
    }

    pauseSong() {
        if (this.songs[this.curSongIdx].paused) {
            this.songs[this.curSongIdx].play();
            this.elSongText.textContent = `Playing ${this.songNames[this.curSongIdx]}`;
        } else {
            this.songs[this.curSongIdx].pause();
            this.elSongText.textContent = `Not Playing`;

        }
    }

    addMenuSFX() {
        let hoverSFX = (e) => {
            document.querySelectorAll(e).forEach(el => (el.addEventListener("mouseenter", () => Game.sounds.playSound("menutap"))));
        };
        let clickSFX = (e) => {
            document.querySelectorAll(e).forEach(el => (el.addEventListener("click", () => Game.sounds.playSound("menuclick"))));
        };
        hoverSFX(".settingRow");
        hoverSFX(".closeDialogButton");
        hoverSFX(".gamemodeSelect");
        hoverSFX(".settingPanelButton");
        clickSFX(".settingPanelButton");
        clickSFX(".closeDialogButton");
    }

    initSounds() {
        setInterval(() => {
            if (this.songs[this.curSongIdx].currentTime == 0) return;
            this.elSongProgress.value =
                (this.songs[this.curSongIdx].currentTime * 100) / this.songs[this.curSongIdx].duration;
        }, 2000);

        this.audioContext = new window.AudioContext();
        this.lowpassfilter = this.audioContext.createBiquadFilter();
        this.lowpassfilter.type = "lowpass";
        this.lowpassfilter.frequency.value = 20000;

        this.sfxGain = this.audioContext.createGain();
        this.sfxGain.connect(this.audioContext.destination);

        this.musicGain = this.audioContext.createGain();
        this.musicGain.gain.value = Game.settings.volume.audioLevel / 100;
        this.lowpassfilter.connect(this.musicGain);
        this.musicGain.connect(this.audioContext.destination);

        // preload all sfx as AudioBuffers for instant playback
        sfxobj.forEach(file => {
            const name = file.name.split(".")[0];
            // keep HTMLAudio fallback
            const a = new Audio(file.path);
            a.preload = "auto";
            a.load();
            this.sfx[name] = a;
            // decode into AudioBuffer for low-latency playback
            fetch(file.path)
                .then(r => r.arrayBuffer())
                .then(buf => this.audioContext.decodeAudioData(buf))
                .then(decoded => { this.sfxBuffers[name] = decoded; })
                .catch(() => {});
        })

        songsobj.forEach(file => {
            const songaudio = new Audio(file.path);
            songaudio.preload = "auto";
            songaudio.load();
            this.songs.push(songaudio);
            this.songNames.push(file.name.split(".")[0]);

            const track = this.audioContext.createMediaElementSource(songaudio);
            track.connect(this.lowpassfilter);
        })

        // resume AudioContext on first user interaction (Safari requirement)
        const resume = () => {
            if (this.audioContext.state === "suspended") this.audioContext.resume();
            document.removeEventListener("click", resume);
            document.removeEventListener("keydown", resume);
        };
        document.addEventListener("click", resume);
        document.addEventListener("keydown", resume);
    }

    setAudioLevel() {
        if (this.musicGain) this.musicGain.gain.value = Number(Game.settings.volume.audioLevel) / 100;
    }

    toggleSongMuffle(muffled) {
        const currentTime = this.audioContext.currentTime;
        this.lowpassfilter.frequency.cancelScheduledValues(currentTime);
        this.lowpassfilter.frequency.setValueAtTime(this.lowpassfilter.frequency.value, currentTime);
        this.lowpassfilter.frequency.exponentialRampToValueAtTime(muffled ? 300 : 20000, currentTime + 1);
    }
}
