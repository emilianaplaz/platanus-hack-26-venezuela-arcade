// Platanus Hack 26 — Caracas Edition
// EL LLANERO SOLITARIO: chase the cow across the savanna from behind the rider. Gallop to the rhythm,
// switch lanes, jump obstacles and throw the lasso before it escapes. Art and music are generated in code.

const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;
const FONT_PIXEL = '"Press Start 2P",monospace';
const FONT_MONO = '"IBM Plex Mono",monospace';
const BEST_SCORE_KEY = 'hi_llanero';
const SONG_KEY = 'song_v2'; // new key so everyone starts on the song

// The chase view is centered on the screen; lanes are 150 px apart at the rider's depth.
const CENTER_X = 400;

// Chase rules
const ESCAPE_DISTANCE = 45;
const ESCAPE_SECONDS = 6;
const MIN_COW_GAP = 7; // closest the horse can get: right behind the cow, sprites just touching
const LASSO_MAX_RANGE = 18;
const TRIP_AVERAGE_INTERVAL = 0.19; // average gap between the last 4 presses that trips the horse
const FALL_SECONDS = 1.3;

// DO NOT replace existing keys — they match the physical arcade cabinet wiring.
// To add local testing shortcuts, append extra keys to any array.
const CABINET_KEYS = {
  P1_U: ['w'],
  P1_D: ['s'],
  P1_L: ['a'],
  P1_R: ['d'],
  P1_1: ['u'],
  P1_2: ['i'],
  P1_3: ['o'],
  P1_4: ['j'],
  P1_5: ['k'],
  P1_6: ['l'],
  P2_U: ['ArrowUp'],
  P2_D: ['ArrowDown'],
  P2_L: ['ArrowLeft'],
  P2_R: ['ArrowRight'],
  P2_1: ['r'],
  P2_2: ['t'],
  P2_3: ['y'],
  P2_4: ['f'],
  P2_5: ['g'],
  P2_6: ['h'],
  START1: ['Enter'],
  START2: ['2'],
};

const KEYBOARD_TO_ARCADE = {};
for (const [arcadeCode, keys] of Object.entries(CABINET_KEYS)) {
  for (const key of keys) {
    KEYBOARD_TO_ARCADE[normalizeIncomingKey(key)] = arcadeCode;
  }
}

// ---------- input ----------
// Every key press increments a counter per arcade code; each pad button remembers how many
// presses its scene has already seen, so two scenes (split screen) can read the same keys.

const pressCounts = Object.create(null);

function wasPressed(button) {
  const count = pressCounts[button.code] || 0;
  if (count > button.seen) {
    button.seen = count;
    return true;
  }
  return false;
}

function anyWasPressed(pads, buttonName) {
  return pads.some((pad) => wasPressed(pad[buttonName]));
}

function createPad(player) {
  const button = (code) => ({ code, seen: pressCounts[code] || 0 });
  const pad = { start: button(player === 'P1' ? 'START1' : 'START2') };
  for (const direction of ['up', 'down', 'left', 'right']) {
    pad[direction] = button(player + '_' + direction[0].toUpperCase());
  }
  for (let number = 1; number <= 6; number++) {
    pad['b' + number] = button(player + '_' + number);
  }
  return pad;
}

window.addEventListener('keydown', (event) => {
  const code = KEYBOARD_TO_ARCADE[normalizeIncomingKey(event.key)];
  if (!code) {
    return;
  }
  if (!event.repeat) {
    pressCounts[code] = (pressCounts[code] || 0) + 1;
  }
  getAudioContext(); // browsers only start audio after a key press
});


// ---------- storage ----------
// Storage is async, so values are cached at boot and read synchronously by the game.

const savedValues = {};

const store = {
  get(key) {
    return savedValues[key] === undefined ? null : savedValues[key];
  },
  set(key, value) {
    savedValues[key] = value;
    try {
      if (window.platanusArcadeStorage) {
        window.platanusArcadeStorage.set(key, value);
      }
    } catch (error) {
      // saving is best-effort
    }
  },
};

async function loadSavedValues() {
  for (const key of [BEST_SCORE_KEY, SONG_KEY]) {
    try {
      const result = await window.platanusArcadeStorage.get(key);
      if (result && result.found && Number.isInteger(result.value) && result.value >= 0) {
        savedValues[key] = result.value;
      }
    } catch (error) {
      // no storage available
    }
  }
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

// ---------- sound effects ----------

let audioContext = null;
let noiseBuffer = null;

function getAudioContext() {
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return null;
    }
    audioContext = new AudioContextClass();
    noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
    const samples = noiseBuffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) {
      samples[i] = Math.random() * 2 - 1;
    }
  }
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
}

// Plays one oscillator that fades out; optionally glides to endFrequency.
function playTone(frequency, duration, type, volume, startTime, endFrequency, output) {
  const context = getAudioContext();
  if (!context) {
    return;
  }
  const start = startTime === undefined ? context.currentTime : startTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, start);
  if (endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
  }
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0005, start + duration);
  oscillator.connect(gain).connect(output || context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.02);
}

function playNoise(duration, volume, startTime, highpassFrequency, output) {
  const context = getAudioContext();
  if (!context) {
    return;
  }
  const start = startTime === undefined ? context.currentTime : startTime;
  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  source.buffer = noiseBuffer;
  filter.type = 'highpass';
  filter.frequency.value = highpassFrequency;
  gain.gain.setValueAtTime(volume, start);
  gain.gain.exponentialRampToValueAtTime(0.0005, start + duration);
  source.connect(filter).connect(gain).connect(output || context.destination);
  source.start(start);
  source.stop(start + duration + 0.02);
}

function playKick(startTime, volume) {
  playTone(160, 0.2, 'sine', volume, startTime, 40);
}

function playSound(name) {
  const context = getAudioContext();
  if (!context) {
    return;
  }
  const now = context.currentTime;
  switch (name) {
    case 'hoof':
      playNoise(0.03, 0.14, now, 500);
      playNoise(0.03, 0.09, now + 0.08, 400);
      break;
    case 'jump':
      playTone(300, 0.25, 'square', 0.05, now, 700);
      break;
    case 'jump':
      playTone(300, 0.18, 'triangle', 0.07, now, 620);
      break;
    case 'land':
      playNoise(0.05, 0.12, now, 600);
      playKick(now, 0.25);
      break;
    case 'lane':
      playTone(420, 0.03, 'square', 0.03);
      break;
    case 'lasso':
      playTone(600, 0.35, 'triangle', 0.08, now, 1600);
      break;
    case 'miss':
      playTone(500, 0.25, 'triangle', 0.06, now, 200);
      break;
    case 'moo':
      playTone(330, 0.55, 'sawtooth', 0.1, now, 170);
      playTone(660, 0.4, 'sine', 0.04, now, 340);
      break;
    case 'catch':
      playTone(660, 0.1, 'square', 0.08, now);
      playTone(880, 0.1, 'square', 0.08, now + 0.1);
      playTone(1320, 0.2, 'square', 0.08, now + 0.2);
      break;
    case 'fall':
      playKick(now, 0.6);
      playNoise(0.3, 0.25, now, 300);
      playTone(300, 0.4, 'sawtooth', 0.1, now, 80);
      break;
    case 'splash':
      playNoise(0.25, 0.15, now, 1500);
      playTone(200, 0.2, 'sine', 0.05, now, 500);
      break;
    case 'warn':
      playTone(220, 0.12, 'square', 0.05);
      break;
    case 'over':
      playTone(220, 0.9, 'sawtooth', 0.15, now, 60);
      break;
  }
}

// ---------- music: five synthesized llanero styles ----------

const ROOT_FREQUENCY = { C: 261.63, D: 293.66, E: 329.63, F: 349.23, G: 392, A: 220, Bb: 233.08, B: 246.94 };

// Builds the notes of a chord such as 'Dm' or 'G'.
function buildChord(name) {
  const isMinor = name.endsWith('m');
  const root = ROOT_FREQUENCY[isMinor ? name.slice(0, -1) : name];
  const third = root * (isMinor ? 1.1892 : 1.2599);
  const fifth = root * 1.4983;
  return {
    bass: root / 4,
    triad: [root, third, fifth, root * 2],
    arpeggio: [root, third, fifth, root * 2, third * 2, fifth * 2],
    scale: [root, root * 1.1225, third, root * 1.3348, fifth, root * 1.6818, root * (isMinor ? 1.7818 : 1.8877), root * 2],
  };
}

// The song, D minor, 2/4. Each bar is 8 sixteenth-note slots:
// a note name (octave 4 = middle C), '-' holds the previous note, '.' is a rest.
const CABALLO_BARS = [
  // section B
  '. . . . . A3 D4 E4', 'F4 - - - F4 F4 F4 -', 'E4 - - - E4 F4 G4 -', 'G4 - A4 - - . . A4',
  'D5 - D5 A4 F4 - Bb4 A4', 'A4 - E4 - D4 - - -', '. . . . . . . .', '. . . . . . . C#5',
  'E5 E5 E5 C#5 D5 - A4 -', 'A4 - G4 - . . . G4', 'Bb4 Bb4 Bb4 - Bb4 G4 F4 E4', 'E4 - E4 . . . . A4',
  'A4 - A4 G4 - G4 - -', 'G4 - D4 - - - - -', 'D4 - - - . . A3 D4', 'E4 - - - . . . .',
  // section C
  'G4 G4 F4 . E4 F4 - -', 'G4 G4 G4 - A4 - Bb4 -', 'Bb4 - F5 - E5 D5 A4 -', 'A4 - - - . . . .',
  'F4 F4 E4 . D4 E4 - -', 'F4 - F4 - G4 - A4 -', 'D5 - - A4 G4 - F4 -', 'E4 - - - . . . E4',
  'E4 - D4 - C#4 - D4 -', 'E4 - - . E4 - G4 A4', 'D5 - - A4 F4 - E4 -', 'D4 - - - - - - -',
  'F4 F4 E4 . D4 E4 - -', 'F4 - F4 - G4 - A4 -', 'D5 - - A4 G4 - F4 -', 'D4 - - - - - - -',
];

// Turns the bar strings into { frequency, length in steps } events indexed by step.
function parseMelody(bars) {
  const semitonesFromC = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
  const events = [];
  let last = null;
  bars.forEach((bar, barIndex) => {
    bar.split(' ').forEach((token, slot) => {
      if (token === '-') {
        if (last) {
          last.length++;
        }
      } else if (token === '.') {
        last = null;
      } else {
        const accidental = token[1] === '#' ? 1 : token[1] === 'b' ? -1 : 0;
        const octave = Number(token[token.length - 1]);
        const semitones = semitonesFromC[token[0]] + accidental + (octave - 4) * 12;
        last = { frequency: 440 * Math.pow(2, semitones / 12), length: 1 };
        events[barIndex * 8 + slot] = last;
      }
    });
  });
  return events;
}

const CABALLO_LEAD = parseMelody(CABALLO_BARS);

// Each song plays one step at a time: play(music, step, bar, time, stepDuration, chord, intense).
// `intense` is true while the horse is galloping fast, which adds extra layers.
const SONGS = [
  {
    name: 'SONG',
    stepsPerBar: 8,
    bpm: 360,
    progression: [
      'Dm', 'Dm', 'Dm', 'Dm', 'Dm', 'Dm', 'A', 'A', 'A', 'A', 'Bb', 'A', 'A', 'Dm', 'Dm', 'A',
      'Gm', 'Gm', 'Gm', 'Gm', 'Dm', 'Dm', 'Dm', 'Dm', 'A', 'A', 'Dm', 'Dm', 'Dm', 'Dm', 'A', 'Dm',
    ],
    play(music, step, bar, time, stepDuration, chord, intense) {
      if (step % 2 === 0) {
        music.hiss(time, 0.03, step % 4 === 0 ? 0.06 : 0.035, 7000);
      }
      if (step === 0 || step === 4) {
        music.tone(step === 0 ? chord.bass : chord.bass * 1.5, time, 0.3, 'triangle', 0.17);
      }
      if (step === 2 || step === 6) {
        chord.triad.slice(0, 3).forEach((frequency, i) => music.tone(frequency, time + i * 0.015, 0.14, 'square', 0.018));
      }
      const note = CABALLO_LEAD[(bar * 8 + step) % (CABALLO_BARS.length * 8)];
      if (note) {
        const duration = note.length * stepDuration * 0.95;
        music.tone(note.frequency, time, duration, 'square', 0.05);
        music.tone(note.frequency * 0.5, time, duration, 'triangle', 0.03);
        if (intense) {
          music.tone(note.frequency * 2, time, Math.min(duration, 0.12), 'square', 0.015);
        }
      }
    },
  },
  {
    name: 'JOROPO',
    stepsPerBar: 6,
    bpm: 290,
    progression: ['D', 'D', 'G', 'A', 'D', 'Bm', 'G', 'A'],
    play(music, step, bar, time, stepDuration, chord, intense) {
      music.hiss(time, 0.05, step % 3 === 0 ? 0.09 : 0.05, 6000);
      if (step % 3 === 1) {
        music.hiss(time + stepDuration / 2, 0.03, 0.03, 7000);
      }
      if (step === 0) {
        music.tone(chord.bass, time, 0.35, 'triangle', 0.16);
      }
      if (step === 3) {
        music.tone(chord.bass * 1.5, time, 0.3, 'triangle', 0.12);
      }
      if (step === 5) {
        music.tone(chord.bass * 2, time, 0.15, 'triangle', 0.08);
      }
      if ([0, 2, 3, 5].includes(step)) {
        chord.triad.forEach((frequency, i) => music.tone(frequency, time + i * 0.012, 0.22, 'triangle', 0.035));
      } else {
        music.hiss(time, 0.04, 0.05, 2500);
      }
      if (intense) {
        // harp: walk up and down the arpeggio
        const notes = chord.arpeggio;
        const cycle = notes.length * 2;
        const harpNote = (index) => {
          const i = index % cycle;
          return i < notes.length ? notes[i] : notes[cycle - 1 - i];
        };
        music.tone(harpNote(music.step * 2), time, 0.3, 'sine', 0.07);
        music.tone(harpNote(music.step * 2 + 1), time + stepDuration / 2, 0.3, 'sine', 0.06);
      }
    },
  },
  {
    name: 'LLANERO SOLITARIO',
    stepsPerBar: 6,
    bpm: 200,
    progression: ['G', 'G', 'C', 'D', 'G', 'Em', 'C', 'D'],
    play(music, step, bar, time, stepDuration, chord, intense) {
      music.hiss(time, 0.06, step === 0 ? 0.06 : 0.03, 5000);
      if (step === 0) {
        music.tone(chord.bass, time, 0.6, 'sine', 0.18);
      }
      if (step === 3) {
        music.tone(chord.bass * 1.5, time, 0.5, 'sine', 0.12);
      }
      music.tone(chord.triad[step % 4], time, 0.3, 'triangle', 0.03);
      const notes = chord.arpeggio;
      const melodyIndex = [0, 2, 4, 5, 4, 2, 3, 1, 0, 2, 4, 3][(bar * 6 + step) % 12];
      music.tone(notes[melodyIndex % notes.length], time, 0.45, 'sine', intense ? 0.08 : 0.05);
      if (step % 3 === 0) {
        music.tone(notes[(melodyIndex + 2) % notes.length] * 0.5, time + stepDuration * 0.5, 0.3, 'sine', 0.03);
      }
    },
  },
  {
    name: 'RANCHERA',
    stepsPerBar: 3,
    bpm: 150,
    progression: ['A', 'A', 'D', 'E', 'A', 'A', 'E', 'A'],
    play(music, step, bar, time, stepDuration, chord, intense) {
      if (step === 0) {
        music.tone(chord.bass, time, 0.5, 'sine', 0.22);
        music.tone(chord.bass, time, 0.1, 'triangle', 0.1);
      } else {
        chord.triad.forEach((frequency, i) => music.tone(frequency * 0.5, time + i * 0.008, 0.14, 'triangle', 0.045));
      }
      music.hiss(time, 0.03, step ? 0.04 : 0.02, 3000);
      const melody = [4, 4, 5, 4, 2, 0, 2, 4, 7, 7, 5, 4, 2, 4, 2, 0, 4, 5, 7, 5, 4, 2, 0, 0];
      const degree = melody[(bar * 3 + step) % melody.length];
      const frequency = chord.scale[degree % 8] * (degree >= 8 ? 2 : 1);
      music.tone(frequency, time, stepDuration * 0.95, 'sawtooth', intense ? 0.05 : 0.035);
      music.tone(frequency * 1.005, time, stepDuration * 0.95, 'sawtooth', 0.015);
      if (bar % 2 === 1) {
        music.tone(chord.scale[(degree + 2) % 8], time, stepDuration * 0.9, 'sawtooth', 0.02);
      }
    },
  },
  {
    name: 'GAITA ZULIANA',
    stepsPerBar: 8,
    bpm: 240,
    progression: ['C', 'C', 'F', 'G', 'C', 'Am', 'F', 'G'],
    play(music, step, bar, time, stepDuration, chord, intense) {
      music.hiss(time, 0.05, step % 2 ? 0.04 : 0.08, 5000);
      if (step === 0 || step === 6) {
        // furro: a falling sawtooth growl
        music.tone(chord.bass * 1.5, time, 0.3, 'sawtooth', 0.14, chord.bass * 0.9);
      }
      if (step === 2 || step === 6) {
        music.tambourine(time, 0.3);
      }
      if (step === 4) {
        music.tambourine(time, 0.18);
      }
      if ([0, 3, 4, 7].includes(step)) {
        chord.triad.forEach((frequency, i) => music.tone(frequency, time + i * 0.01, 0.2, 'triangle', 0.035));
      }
      const melody = [0, 2, 4, 4, 5, 4, 2, 0, 2, 4, 5, 7, 5, 4, 2, 2];
      const degree = melody[(bar * 8 + step) % melody.length];
      if (step % 2 === 0 || intense) {
        music.tone(chord.scale[degree % 8] * (degree >= 8 ? 2 : 1), time, 0.25, 'square', 0.03);
      }
    },
  },
  {
    name: 'CALIPSO DE EL CALLAO',
    stepsPerBar: 8,
    bpm: 210,
    progression: ['C', 'C', 'F', 'G', 'C', 'C', 'G', 'C'],
    play(music, step, bar, time, stepDuration, chord, intense) {
      music.hiss(time, 0.04, step % 2 ? 0.035 : 0.07, 7000);
      if (step === 0 || step === 4) {
        playKick(time, 0.35);
      }
      if (step === 2 || step === 6) {
        music.tone(800, time, 0.08, 'square', 0.04);
      }
      if (step === 0 || step === 4 || step === 7) {
        music.tone(step === 7 ? chord.bass * 1.5 : chord.bass, time, 0.3, 'triangle', 0.16);
      }
      // steel pan: a note plus two bright overtones
      const steelPan = (frequency, when, volume) => {
        music.tone(frequency, when, 0.35, 'sine', volume);
        music.tone(frequency * 2, when, 0.12, 'sine', volume * 0.5);
        music.tone(frequency * 3.01, when, 0.06, 'sine', volume * 0.25);
      };
      const panSteps = [0, 3, 4, 6];
      if (panSteps.includes(step)) {
        const notes = chord.arpeggio;
        const i = (bar * 4 + panSteps.indexOf(step)) % notes.length;
        steelPan(notes[i], time, 0.07);
        steelPan(notes[(i + 2) % notes.length], time, 0.04);
      }
      if (intense && step % 2 === 1) {
        steelPan(chord.scale[(bar + step) % 8] * 2, time, 0.04);
      }
    },
  },
];

const music = {
  enabled: true,
  nextNoteTime: null,
  step: 0,
  masterGain: null,
  level: 0,
  songIndex: 0,
  titleTimer: 0, // how long the song name stays on screen after switching

  output() {
    const context = getAudioContext();
    if (!context) {
      return null;
    }
    if (!this.masterGain) {
      this.masterGain = context.createGain();
      this.masterGain.gain.value = 0.9;
      this.masterGain.connect(context.destination);
    }
    return this.masterGain;
  },

  tone(frequency, time, duration, type, volume, endFrequency) {
    playTone(frequency, duration, type, volume, time, endFrequency, this.output());
  },

  hiss(time, duration, volume, highpassFrequency) {
    playNoise(duration, volume, time, highpassFrequency, this.output());
  },

  tambourine(time, volume) {
    this.tone(220, time, 0.18, 'triangle', volume, 70);
    this.hiss(time, 0.04, volume * 0.3, 2000);
  },

  currentSong() {
    return SONGS[this.songIndex % SONGS.length];
  },

  nextSong() {
    this.songIndex = (this.songIndex + 1) % SONGS.length;
    store.set(SONG_KEY, this.songIndex);
    this.step = 0;
    this.nextNoteTime = null;
    this.titleTimer = 2.5;
    playTone(1200, 0.06, 'square', 0.05);
  },

  toggle() {
    this.enabled = !this.enabled;
  },

  // Schedules upcoming notes a little ahead of the audio clock.
  update(races, isGameOver, dt) {
    const context = getAudioContext();
    if (!context) {
      return;
    }
    this.titleTimer = Math.max(0, this.titleTimer - dt);
    const now = context.currentTime;
    const output = this.output();
    if (!this.enabled) {
      output.gain.setTargetAtTime(0, now, 0.1);
      this.nextNoteTime = null;
      return;
    }
    // quieter while the horse is down or after game over
    const volume = races.some((race) => race.fallTimer > 0) ? 0.22 : isGameOver ? 0.45 : 1;
    output.gain.setTargetAtTime(volume * 0.9, now, 0.15);

    if (this.nextNoteTime === null || this.nextNoteTime < now - 0.5) {
      this.nextNoteTime = now + 0.1;
    }
    const song = this.currentSong();
    const stepDuration = 60 / (song.bpm * (1 + this.level * 0.03)); // 3% faster per level
    const intense = !isGameOver && races.some((race) => race.speed > race.maxSpeed() * 0.45);
    while (this.nextNoteTime < now + 0.25) {
      const step = this.step % song.stepsPerBar;
      const bar = Math.floor(this.step / song.stepsPerBar) % song.progression.length;
      song.play(this, step, bar, this.nextNoteTime, stepDuration, buildChord(song.progression[bar]), intense);
      this.step++;
      this.nextNoteTime += stepDuration;
    }
  },
};

// ---------- pixel art ----------

const PALETTE = {
  k: '#141414', w: '#f4f4f4', p: '#f3b9a0', b: '#9c6a3c', d: '#4f2f16', h: '#d9a066', y: '#e8c66e', u: '#2b3f8a',
  g: '#4f9a3a', G: '#2e6b26', f: '#b07a46', F: '#6b4423', e: '#e04a2f', r: '#8d8a7c', R: '#5f5c52', o: '#ffb347',
  q: '#f08ab0', n: '#2a1608',
};
const SILHOUETTE_CSS = '#33281a';


// Horse: one body, three leg poses. Cow: legs in two poses, and a blink frame.
const HORSE_BODY = ['.......yyyy.......', '.....yyeeeeyy.....', '.......hhhh.......', '......wwwwww......', '.....wwwwwwww.....', '.....wwwwwwww.....', '.....wwwwwwww.....', '....uuwwwwwwuu....', '....uu.bbbbbb.uu..', '...uu.bbbbbbbb.uu.', '...kk.bbbbbbbb.kk.', '......bbbbbbbb....', '.....bbbbbbbbbb...', '.....bbbddbbbbb...', '.....bbbddbbbbb...', '.....bbbddbbbbb...', '.....bbbddbbbbb...', '......bbddbbbb....', '......bbddbbbb....'];
const HORSE_LEGS = [['......b.dd..bb....', '.....bb.dd...bb...', '....bb...d....bb..', '....bb........bb..', '....kk........kk..'],
  ['......b.dd..bb....', '......b.dd..bb....', '......bb.d..bb....', '......bb....bb....', '......kk....kk....'],
  ['.....b..dd...bb...', '....bb..dd....bb..', '...bb....d.....bb.', '...bb..........bb.', '...kk..........kk.']];
const COW_HEAD = ['......kk......', '.....wwww.....', '....wkwwkw....'];
const COW_BLINK = ['....kkwwkk....', '...wkwwwwkw...', '...wwwkkwww...'];
const COW_LEGS = [['...kk....kk...', '...kk....kk...', '...kk....kk...'],
  ['..kk......kk..', '..kk......kk..', '...kk....kk...']];
const COW_BODY = ['...wwwwwwww...', '..wwkkwwwwkw..', '..wwkkwwwwww..', '..wwwwwkkwww..', '..wwwwwkkwww..', '..wwwwwwwwww..', '..wwwppppwww..', '...wwppppww...'];

const SPRITES = {
  fence:['f..................f','ffffffffffffffffffff','f..................f','f..................f','ffffffffffffffffffff','f..................f','f..................f','ffffffffffffffffffff','F..................F','F..................F'],
  bush:['.....gggg.....','...gggoggggg..','..ggGgggggGg..','.ggogggGgggog.','.gGggggggggGg.','.gggggGgogggg.','..ggGggggggg..','...gggggggg...','....dd..dd....'],
  toro:['ww..........ww','.wwddddddddww.','...dddkkddd...','..dddddddddd..','.dddddddddddd.','.dddddddddddd.','.dddddddddddd.','.dddddddddddd.','.dddddddddddd.','..dddddddddd..','..dddddddddd..','...kk....kk...','...kk....kk...','...kk....kk...'],
  log:['.FFFFFFFFFFFFFFFFFF.','FffffffffffffffffffF','FffFfffffffFfffffffF','FffffffffffffffffffF','.FFFFFFFFFFFFFFFFFF.','..dd..........dd....'],
  chig:['..bbbbbb..','.bbbbbbbb.','bbkbbbbbbb','bbbbbbbbbb','.bb....bb.','.dd....dd.'],
  hat:['..yyyy..','yyeeeeyy','yyyyyyyy'],
  palm:['....g..g..g.....','..gg.gggg.gg....','.ggggggggggggg..','gg..ggggggg..gg.','....gg.gg.gg....','.....g.dd.g.....','.......dd.......','.......dd.......','.......dd.......','......dd........','......dd........','......dd........','.....dd.........','.....dd.........','.....dd.........','....ddd.........'],
  tuft:['.g..G..g.','gG.gGg.Gg','.GgGGGgG.'],
  post:['FF','ff','ff','ff','FF','FF'],
  tree:['....GGGG....','..GGggGGGG..','.GGggggGGGG.','GGgggGGgGGGG','.GGGGggGGGG.','..GGGGGGGG..','.....dd.....','.....dd.....','.....dd.....','....dddd....'],
};

// Title-screen silhouettes: side views built from filled rectangles ([x, y, width, height]), so a
// gallop can have four frames without storing four images.
function silhouette(width, height, rects) {
  const grid = Array.from({ length: height }, () => Array(width).fill('.'));
  for (const [x, y, w, h] of rects) {
    for (let row = y; row < y + h; row++) {
      for (let col = x; col < x + w; col++) {
        if (grid[row] && grid[row][col]) {
          grid[row][col] = '#';
        }
      }
    }
  }
  return grid.map((row) => row.join(''));
}

// One leg hanging from (x, y): reaching forward (right), straight down, or kicked back.
const LEG_CYCLE = ['forward', 'down', 'back', 'down'];

function legRects(x, y, length, pose) {
  if (pose === 'down') {
    return [[x, y, 2, length]];
  }
  const upper = Math.ceil(length / 2);
  const shift = pose === 'forward' ? 2 : -2;
  return [[x, y, 2, upper], [x + shift, y + upper, 2, length - upper]];
}

// Gallop: each pair of legs moves through the cycle, the far leg a step behind the near one,
// and the back legs half a cycle apart from the front ones.
function gallopLegs(frame, frontX, backX, y, length) {
  const pose = (offset) => LEG_CYCLE[(frame + offset) % 4];
  return [
    ...legRects(frontX, y, length, pose(0)),
    ...legRects(frontX + 2, y, length, pose(1)),
    ...legRects(backX, y, length, pose(2)),
    ...legRects(backX + 2, y, length, pose(3)),
  ];
}

// The llanero on his horse, seen from the side, hat and raised arm included.
function horseSideFrame(frame) {
  const tail = [[3, 8, 2, 1], [1 + (frame % 2), 9, 3, 2], [frame % 2 ? 0 : 1, 11, 3, 1]];
  return silhouette(25, 19, [
    [6, 8, 10, 5], [5, 9, 12, 3], [15, 5, 3, 4], [17, 5, 5, 3], [20, 7, 3, 2], [17, 3, 1, 2], [19, 4, 1, 1], ...tail,
    [8, 0, 3, 1], [6, 1, 7, 1], [8, 2, 3, 2], [7, 4, 4, 4], [11, 5, 3, 1], [9, 8, 2, 3],
    ...gallopLegs(frame, 14, 5, 13, 5),
  ]);
}

// A cow running ahead of him; her tail swings with every stride.
function cowSideFrame(frame) {
  const swing = [0, -1, 0, 1][frame];
  return silhouette(22, 16, [
    [5, 3, 11, 5], [4, 4, 13, 3], [10, 2, 5, 1], [9, 8, 2, 1],
    [14, 3, 3, 3], [16, 4, 4, 4], [19, 6, 2, 2], [16, 2, 1, 2], [18, 2, 1, 2], [15, 1, 1, 1], [19, 1, 1, 1], [19, 3, 2, 1],
    [2, 3, 2, 1], [1 + swing, 4, 1, 5], [swing, 8, 3, 2],
    ...gallopLegs(frame, 13, 4, 8, 7),
  ]);
}

for (let i = 0; i < 3; i++) {
  SPRITES['horse' + i] = [...HORSE_BODY, ...HORSE_LEGS[i]];
}
SPRITES.cow0 = [...COW_HEAD, ...COW_BODY, ...COW_LEGS[0]];
SPRITES.cow1 = [...COW_HEAD, ...COW_BODY, ...COW_LEGS[1]];
SPRITES.cow2 = [...COW_BLINK, ...COW_BODY, ...COW_LEGS[0]];

function drawSprite(scene, key, rows, colorOf) {
  const canvas = scene.textures.createCanvas(key, rows[0].length, rows.length);
  rows.forEach((row, y) => {
    [...row].forEach((letter, x) => {
      if (letter !== '.') {
        canvas.context.fillStyle = colorOf(letter);
        canvas.context.fillRect(x, y, 1, 1);
      }
    });
  });
  canvas.refresh();
}

// Second player: the same horse, ridden by a woman (red hat, pink poncho, dark hair).
function womanRows(rows) {
  return rows.map((row, y) => {
    if (y < 2) {
      return row.replace(/[ye]/g, (letter) => (letter === 'y' ? 'e' : 'y'));
    }
    return y >= 3 && y <= 7 ? row.replace(/w+/, (run) => 'n' + 'q'.repeat(run.length - 2) + 'n') : row;
  });
}

// Tint only works in WebGL, so variants (golden cow, woman rider, title-screen silhouettes) are separate textures.
function makeTextures(scene) {
  if (scene.textures.exists('horse0')) {
    return;
  }
  const normal = (letter) => PALETTE[letter];
  for (const key in SPRITES) {
    drawSprite(scene, key, SPRITES[key], normal);
  }
  for (let i = 0; i < 3; i++) {
    drawSprite(scene, 'cowG' + i, SPRITES['cow' + i], (letter) => PALETTE[letter === 'w' ? 'y' : letter]);
    drawSprite(scene, 'horseF' + i, womanRows(SPRITES['horse' + i]), normal);
  }
  for (let frame = 0; frame < 4; frame++) {
    drawSprite(scene, 'horse' + frame + 'Dark', horseSideFrame(frame), () => SILHOUETTE_CSS);
    drawSprite(scene, 'cow' + frame + 'Dark', cowSideFrame(frame), () => SILHOUETTE_CSS);
  }
  drawSprite(scene, 'hatF', SPRITES.hat.map((row) => row.replace(/[ye]/g, (letter) => (letter === 'y' ? 'e' : 'y'))), normal);
}

// ---------- sunset atmosphere and UI helpers (shared by the title screen and the chase) ----------

const UI_CREAM = '#ffe9c0';
const UI_STROKE = '#3a1408';
const UI_PANEL = 0x3a1e0e;
const UI_GOLD = 0xf2b24a;
const SILHOUETTE = 0x33281a;

function mixColors(colorA, colorB, t) {
  const channel = (shift) => Math.round(((colorA >> shift) & 255) * (1 - t) + ((colorB >> shift) & 255) * t);
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

// Fills a rectangle with a gradient made of thin flat bands. Phaser's own gradient fill is
// ignored by the canvas renderer, which would leave an opaque black rectangle.
function fillGradient(graphics, x, y, width, height, colorA, colorB, alphaA, alphaB, horizontal, steps) {
  const bands = steps || 24;
  for (let i = 0; i < bands; i++) {
    const t = (i + 0.5) / bands;
    graphics.fillStyle(mixColors(colorA, colorB, t), alphaA + (alphaB - alphaA) * t);
    if (horizontal) {
      const from = x + Math.floor((width * i) / bands);
      graphics.fillRect(from, y, x + Math.floor((width * (i + 1)) / bands) - from, height);
    } else {
      const from = y + Math.floor((height * i) / bands);
      graphics.fillRect(x, from, width, y + Math.floor((height * (i + 1)) / bands) - from);
    }
  }
}

function drawPanel(graphics, x, y, width, height, alpha) {
  graphics.fillStyle(UI_PANEL, alpha).fillRoundedRect(x, y, width, height, 14);
  graphics.lineStyle(2, UI_GOLD, 0.8).strokeRoundedRect(x, y, width, height, 14);
  graphics.lineStyle(1, 0xffd9a0, 0.18).strokeRoundedRect(x + 4, y + 4, width - 8, height - 8, 10);
}

// A rounded progress bar with a glossy highlight.
function drawMeter(graphics, x, y, width, height, fraction, color) {
  graphics.fillStyle(UI_PANEL, 0.75).fillRoundedRect(x, y, width, height, height / 2);
  if (fraction > 0) {
    const fillWidth = Math.max(height, width * Math.min(1, fraction));
    graphics.fillStyle(color, 1).fillRoundedRect(x, y, fillWidth, height, height / 2);
    graphics.fillStyle(0xffffff, 0.25).fillRoundedRect(x + 2, y + 1, fillWidth - 4, height / 3, height / 6);
  }
  graphics.lineStyle(1.5, UI_GOLD, 0.6).strokeRoundedRect(x, y, width, height, height / 2);
}

// A moriche palm seen against the sunset.
function drawPalmSilhouette(graphics, x, baseY, height, lean) {
  const bendX = x + lean * 0.4;
  const bendY = baseY - height * 0.55;
  const topX = x + lean;
  const topY = baseY - height;
  graphics.lineStyle(5, SILHOUETTE, 1);
  graphics.lineBetween(x, baseY, bendX, bendY);
  graphics.lineBetween(bendX, bendY, topX, topY);
  graphics.lineStyle(3, SILHOUETTE, 1);
  for (const degrees of [-165, -135, -100, -75, -45, -15, 160, 20]) {
    const angle = (degrees * Math.PI) / 180;
    const midX = topX + Math.cos(angle) * 18;
    const midY = topY + Math.sin(angle) * 10;
    graphics.lineBetween(topX, topY, midX, midY);
    graphics.lineBetween(midX, midY, topX + Math.cos(angle) * 40, topY + Math.sin(angle) * 18 + 14);
  }
}

// ---------- title screen ----------

const MENU_HORIZON = 232;
const MENU_LINES_TOP = 268;
const MENU_LINES = [
  'B1: galopar a ritmo (muy rapido = caida)',
  'Joystick izq/der: cambiar de carril',
  'B2: lanzar el lazo (vaca en tu carril, 7-18 m)',
  'Joystick arriba (W): saltar (menos las cercas)',
  'Si la vaca se aleja mas de 40 m, se escapa',
  'JUGADORA 2: flechas, R galopa, T lazo',
];
const MENU_MODES = [
  { label: '1 JUGADOR', players: 1 },
  { label: '2 JUGADORES', players: 2 },
];

class MenuScene extends Phaser.Scene {
  constructor() {
    super('menu');
  }

  create() {
    this.pads = [createPad('P1'), createPad('P2')];
    this.elapsed = 0;
    this.selectedMode = 0;
    makeTextures(this);

    this.drawBackdrop();
    this.skyGraphics = this.add.graphics().setDepth(-1); // animated: clouds, birds, dust
    drawPanel(this.add.graphics(), 70, 250, 660, 324, 0.5);

    // the rider and the cow run along the horizon as silhouettes
    this.horseImage = this.add.image(GAME_WIDTH / 2 - 170, 188, 'horse0Dark').setScale(5).setDepth(1);
    this.cowImage = this.add.image(GAME_WIDTH / 2 + 170, 196, 'cow0Dark').setScale(5).setDepth(1);

    this.addText(GAME_WIDTH / 2, 62, 'LLANERO SOLITARIO', FONT_PIXEL, 54, '#ffd166').setStroke('#7a2410', 9).setShadow(0, 5, '#2a0a10', 0, true, true).setDepth(2);
    this.addText(GAME_WIDTH / 2, 112, 'PERSIGUE A LA VACA POR LA SABANA', FONT_PIXEL, 10, '#ffffff').setStroke('#7a3a14', 4).setDepth(2);
    MENU_LINES.forEach((line, i) => this.addText(GAME_WIDTH / 2 + 20, MENU_LINES_TOP + i * 26, line, FONT_MONO, 16, UI_CREAM));
    this.drawControlIcons();

    this.modeTexts = MENU_MODES.map((mode, i) => this.addText(GAME_WIDTH / 2, 428 + i * 36, mode.label, FONT_PIXEL, 13, '#a58a7a'));
    this.startText = this.addText(GAME_WIDTH / 2, 552, 'PULSA START', FONT_PIXEL, 14, '#ffd166');
    this.addText(GAME_WIDTH / 2, 586, 'Platanus Hack 26 · Caracas', FONT_MONO, 12, '#c9a58a');
  }

  addText(x, y, content, fontFamily, fontSize, color) {
    return this.add
      .text(x, y, content, { fontFamily, fontSize: fontSize + 'px', color, stroke: UI_STROKE, strokeThickness: Math.max(2, Math.round(fontSize / 6)) })
      .setOrigin(0.5);
  }

  // The llano at sunset: a low sun on the horizon, a mirror of flooded plain, palms and a far tree line.
  drawBackdrop() {
    const scene = this.add.graphics().setDepth(-3);
    fillGradient(scene, 0, 0, GAME_WIDTH, 110, 0x5fb0e8, 0xa8d8f0, 1, 1, false, 28);
    fillGradient(scene, 0, 110, GAME_WIDTH, 80, 0xa8d8f0, 0xffd9a0, 1, 1, false, 20);
    fillGradient(scene, 0, 190, GAME_WIDTH, MENU_HORIZON - 190, 0xffd9a0, 0xffb050, 1, 1, false, 14);

    const sunX = GAME_WIDTH / 2;
    for (const [radius, alpha] of [[190, 0.1], [140, 0.16], [100, 0.24]]) {
      scene.fillStyle(0xfff0a0, alpha).fillCircle(sunX, MENU_HORIZON, radius);
    }
    scene.fillStyle(0xfff6c0, 1).fillCircle(sunX, MENU_HORIZON, 62);

    // sunlit flooded plain below the horizon, mirroring the sky and the sun
    fillGradient(scene, 0, MENU_HORIZON, GAME_WIDTH, GAME_HEIGHT - MENU_HORIZON, 0xb8c85a, 0x6f9a38, 1, 1, false, 30);
    fillGradient(scene, 0, MENU_HORIZON, GAME_WIDTH, 70, 0xffd080, 0xffd080, 0.6, 0, false, 14);
    for (let i = 0; i < 12; i++) {
      const streak = 150 - i * 11;
      scene.fillStyle(0xfff0b0, 0.7 - i * 0.05).fillRect(sunX - streak / 2, MENU_HORIZON + 6 + i * 7, streak, 3);
    }

    scene.fillStyle(0x35592a, 1);
    for (let i = 0; i < 44; i++) {
      scene.fillEllipse(i * 19 + ((i * 37) % 11), MENU_HORIZON, 16 + ((i * 13) % 14), 8 + ((i * 7) % 10));
    }
    drawPalmSilhouette(scene, 55, MENU_HORIZON + 6, 130, 18);
    drawPalmSilhouette(scene, 105, MENU_HORIZON + 6, 92, -10);
    drawPalmSilhouette(scene, 700, MENU_HORIZON + 6, 100, 12);
    drawPalmSilhouette(scene, 752, MENU_HORIZON + 6, 138, -16);
  }

  // Icons next to the instructions: gallop button, joystick, lasso button, jump, warning.
  drawControlIcons() {
    const icons = this.add.graphics().setDepth(1);
    const x = GAME_WIDTH / 2 - 280;
    const rowY = (row) => MENU_LINES_TOP + row * 26;
    const label = (text, y, size, offsetY) => this.addText(x, y + offsetY, text, FONT_PIXEL, size, '#2a1208').setStroke('#2a1208', 0).setDepth(2);

    const button = (y, color, text) => {
      icons.fillStyle(0x2a1208, 1).fillCircle(x, y + 3, 12);
      icons.fillStyle(color, 1).fillCircle(x, y, 12);
      icons.fillStyle(0xffffff, 0.3).fillEllipse(x - 3, y - 5, 12, 5);
      label(text, y, 8, 0);
    };
    button(rowY(0), 0xffd166, 'B1');

    const joystickY = rowY(1);
    icons.fillStyle(0x2a1208, 1).fillRoundedRect(x - 20, joystickY - 9, 40, 18, 5);
    icons.fillStyle(0xffb36b, 1);
    icons.fillTriangle(x - 16, joystickY, x - 6, joystickY - 7, x - 6, joystickY + 7);
    icons.fillTriangle(x + 16, joystickY, x + 6, joystickY - 7, x + 6, joystickY + 7);

    button(rowY(2), 0xff6a7a, 'B2');
    button(rowY(3), 0x9be08a, 'W');

    const warningY = rowY(4);
    icons.fillStyle(0xff6a5a, 1).fillTriangle(x - 12, warningY + 9, x + 12, warningY + 9, x, warningY - 10);
    label('!', warningY, 10, 2);
  }

  update(time, delta) {
    this.elapsed += delta / 1000;
    this.handleMusicInput(delta / 1000);
    this.handleModeInput();
    this.animate();
    if (anyWasPressed(this.pads, 'start')) {
      playTone(880, 0.1, 'square', 0.06);
      if (MENU_MODES[this.selectedMode].players === 2) {
        // 2-player coleo: two chases side by side, one per half of the screen
        this.scene.launch('chase2', { mode: '2p', side: 1 });
        this.scene.start('chase', { mode: '2p', side: 0 });
      } else {
        this.scene.start('chase', { mode: '1p' });
      }
    }
  }

  handleMusicInput(dt) {
    music.level = 0;
    if (anyWasPressed(this.pads, 'b4')) {
      music.nextSong();
    }
    if (anyWasPressed(this.pads, 'b5')) {
      music.toggle();
    }
    music.update([], false, dt);
  }


  handleModeInput() {
    const count = MENU_MODES.length;
    if (anyWasPressed(this.pads, 'up')) {
      this.selectedMode = (this.selectedMode + count - 1) % count;
      playTone(500, 0.04, 'square', 0.04);
    }
    if (anyWasPressed(this.pads, 'down')) {
      this.selectedMode = (this.selectedMode + 1) % count;
      playTone(500, 0.04, 'square', 0.04);
    }
    this.modeTexts.forEach((text, i) => {
      const selected = i === this.selectedMode;
      text.setColor(selected ? '#ffffff' : '#a58a7a').setText((selected ? '> ' : '  ') + MENU_MODES[i].label + (selected ? ' <' : '  '));
    });
  }

  // The llanero swings a rope over his head: a loop that sways and spins, tied to his raised hand.
  drawLasso(graphics, time) {
    const handX = this.horseImage.x + 5;
    const handY = this.horseImage.y - 20;
    const tilt = Math.sin(time * 3) * 0.3;
    const centerX = handX + 40;
    const centerY = handY - 36 + Math.sin(time * 6) * 3;
    const height = 5 + 13 * Math.abs(Math.sin(time * 7)); // the loop turns edge-on and back
    const point = (angle) => ({
      x: centerX + Math.cos(angle) * 30 * Math.cos(tilt) - Math.sin(angle) * height * Math.sin(tilt),
      y: centerY + Math.cos(angle) * 30 * Math.sin(tilt) + Math.sin(angle) * height * Math.cos(tilt),
    });
    graphics.lineStyle(3, SILHOUETTE, 1);
    graphics.beginPath();
    for (let step = 0; step <= 28; step++) {
      const { x, y } = point((step / 28) * Math.PI * 2);
      step === 0 ? graphics.moveTo(x, y) : graphics.lineTo(x, y);
    }
    graphics.strokePath();
    // the rope itself curves from his hand up to the near edge of the loop
    const end = point(Math.PI);
    graphics.beginPath();
    graphics.moveTo(handX, handY);
    for (let step = 1; step <= 8; step++) {
      const t = step / 8;
      const bendX = handX + 4;
      const bendY = handY - 34;
      graphics.lineTo((1 - t) * (1 - t) * handX + 2 * (1 - t) * t * bendX + t * t * end.x, (1 - t) * (1 - t) * handY + 2 * (1 - t) * t * bendY + t * t * end.y);
    }
    graphics.strokePath();
  }

  animate() {
    const time = this.elapsed;
    this.startText.setAlpha(Math.sin(time * 4) > 0 ? 1 : 0.3);

    const sky = this.skyGraphics;
    sky.clear();

    const stride = (rate, offset) => Math.floor(time * rate + offset) % 4;
    const bob = [6, 0, 6, 0]; // high while all four legs are in the air, low at contact
    this.horseImage.setTexture('horse' + stride(7, 0) + 'Dark').setY(190 - bob[stride(7, 0)]);
    this.drawLasso(sky, time);
    this.cowImage.setTexture('cow' + stride(6, 1) + 'Dark').setY(198 - bob[stride(6, 1)]);
  }
}

// ---------- chase rules (no drawing) ----------

// Cow kinds: points multiplier and speed multiplier. Golden and bull appear at higher levels;
// a calf, once lassoed, is followed by its mother (double points if caught within 8 s).
const COW_TYPES = {
  normal: { label: '', points: 1, speed: 1 },
  golden: { label: 'DORADA x3', points: 3, speed: 1.12 },
  bull: { label: 'TORO x2', points: 2, speed: 0.95 },
  calf: { label: 'BECERRO', points: 0.5, speed: 0.75 },
  mother: { label: 'MAMA', points: 2, speed: 1.1 },
};

const FALL_MESSAGES = {
  fence: '¡CHOCASTE LA CERCA!',
  bush: '¡CHOCASTE UN CHAPARRO!',
  log: '¡CHOCASTE EL TRONCO!',
  ditch: '¡CAISTE EN LA ZANJA!',
  herd: '¡CHOCASTE CON LOS CHIGUIRES!',
};

const COLEO_SECONDS = 90;
const coleoScores = [0, 0]; // each split-screen player's points, so both can see who won

// One player's chase: the rider, the cow, the obstacles and the weather.
// Obstacle kinds: fence and bush knock the horse down, a lagoon slows it, a log must be dodged or jumped,
// a ditch (two lanes wide) and a herd of capybaras crossing the road must be jumped or waited out.
class Race {
  constructor(pad, coleo, keys) {
    this.pad = pad;
    this.coleo = coleo;
    this.keys = keys; // names of this player's gallop and lasso buttons, for the hints
    this.time = 0;
    this.level = 1;
    this.timer = coleo ? COLEO_SECONDS : 0;
    this.started = false;
    this.gameOverMessage = null;

    this.lane = 1; // 0, 1 or 2
    this.laneX = 0; // smoothed lane position, -1..1
    this.speed = 0; // m/s
    this.distance = 0; // meters run so far
    this.score = 0;
    this.cowsCaught = 0;

    this.tapIntervals = [];
    this.lastTapTime = -9;
    this.tapQuality = []; // last presses: 1 = good rhythm, lower = too fast or too slow
    this.boostSteps = 0; // after a fall, the next presses push twice as hard
    this.bounce = 0;
    this.jumpHeight = 0;
    this.jumpVelocity = 0;

    this.fallTimer = 0;
    this.fallCount = 0;
    this.slowTimer = 0;
    this.lagoonSpeedCap = 5;
    this.banner = '';
    this.bannerTimer = 0;
    this.notice = '';
    this.noticeTimer = 0;

    this.lasso = { timer: 0, cooldown: 0, hit: false };
    this.lassoBuffer = 0; // a press just before the lasso is ready still counts
    this.hints = {};

    this.obstacles = [];
    this.nextObstaclePos = 30;
    this.escapeTimer = 0;
    this.warnTimer = 0;
    this.weather = { type: null, timer: 0, next: 30 + randomBetween(0, 15) };
    this.effects = { caught: 0, fall: false, splash: false }; // one-shot events for the scene to react to

    this.cow = this.createCow(18, 'normal');
  }

  maxSpeed() {
    return 14 + this.level * 1.2;
  }

  points() {
    return this.score + Math.floor(this.distance / 5);
  }

  cowGap() {
    return this.cow.pos - this.distance;
  }

  // slack widens the lane/range check so a throw is forgiving; the green ring uses none, so it never promises a miss
  canLasso(slack = 0) {
    const cow = this.cow;
    const gap = this.cowGap();
    const lasso = this.lasso;
    const ready = this.fallTimer <= 0 && lasso.cooldown <= 0 && lasso.timer <= 0;
    return ready && cow.caughtTimer <= 0 && !cow.charge && Math.abs(cow.laneX - this.laneX) < 0.5 + slack * 0.2 && gap >= MIN_COW_GAP - 0.1 && gap <= LASSO_MAX_RANGE + slack * 2;
  }

  notify(message) {
    this.notice = message;
    this.noticeTimer = 1.8;
  }

  // ----- obstacles -----

  obstacleLaneX(obstacle) {
    if (obstacle.kind === 'herd') {
      return obstacle.x - 1;
    }
    return obstacle.kind === 'ditch' ? obstacle.lane - 0.5 : obstacle.lane - 1;
  }

  hits(obstacle) {
    const ahead = obstacle.pos - this.distance;
    if (obstacle.kind === 'ditch') {
      return ahead > -1.2 && ahead < 1 && Math.abs(this.laneX - (obstacle.lane - 0.5)) < 1;
    }
    return ahead > -0.6 && ahead < 0.8 && Math.abs(this.laneX - this.obstacleLaneX(obstacle)) < 0.5;
  }

  isBlocked(lane, fromPos, toPos) {
    return this.obstacles.some(
      (o) => o.kind !== 'lagoon' && o.kind !== 'herd' && (o.lane === lane || (o.kind === 'ditch' && o.lane + 1 === lane)) && o.pos >= fromPos && o.pos <= toPos,
    );
  }

  spawnObstacle() {
    const pos = this.nextObstaclePos;
    const recentLanes = [0, 1, 2].filter((lane) => this.isBlocked(lane, pos - 20, pos - 0.1));
    const lanes = (recentLanes.length >= 2 ? recentLanes : [0, 1, 2]).sort(() => Math.random() - 0.5);
    const add = (kind, lane, extra) => this.obstacles.push({ kind, lane, pos, hit: false, ...extra });

    const pool = ['ditch', 'herd', 'log', 'log', 'fence', 'fence', 'bush', 'lagoon'];
    let kind = pool[Math.floor(randomBetween(0, pool.length))];
    if (kind === 'ditch' && (this.level < 2 || recentLanes.length)) {
      kind = 'fence';
    }
    if (kind === 'herd' && this.level < 3) {
      kind = 'log';
    }

    if (kind === 'ditch') {
      add('ditch', Math.floor(randomBetween(0, 2)));
    } else if (kind === 'herd') {
      const fromLeft = Math.random() < 0.5;
      add('herd', 1, { x: fromLeft ? -0.6 : 2.6, dir: fromLeft ? 1 : -1 });
    } else if (kind === 'lagoon') {
      add('lagoon', Math.floor(randomBetween(0, 3)));
    } else {
      add(kind, lanes[0]);
      if (kind === 'fence' && this.level >= 3 && !recentLanes.length && Math.random() < 0.4) {
        add('fence', lanes[1]);
      }
    }
    this.nextObstaclePos = pos + Math.max(10, randomBetween(13, 22) - this.level);
  }

  // ----- rider -----

  fall(message) {
    if (this.fallTimer > 0) {
      return;
    }
    this.fallTimer = FALL_SECONDS;
    this.fallCount++;
    this.tapIntervals = [];
    this.speed = 0;
    this.jumpHeight = 0;
    this.jumpVelocity = 0;
    this.boostSteps = 3;
    this.banner = message;
    this.bannerTimer = 1.6;
    this.effects.fall = true;
    playSound('fall');
  }

  handleGallopInput(pressed) {
    if (!pressed || this.fallTimer > 0 || this.jumpHeight > 0) {
      return;
    }
    this.started = true;
    const interval = this.time - this.lastTapTime;
    this.lastTapTime = this.time;
    this.tapIntervals.push(interval);
    if (this.tapIntervals.length > 4) {
      this.tapIntervals.shift();
    }
    const average = this.tapIntervals.reduce((sum, value) => sum + value, 0) / this.tapIntervals.length;

    if (this.tapIntervals.length === 4 && average < TRIP_AVERAGE_INTERVAL) {
      this.fall('¡MUY RAPIDO! EL CABALLO TROPEZO');
      return;
    }
    const quality = interval < 0.2 ? 0.5 : interval > 0.6 ? 0.6 : 1;
    this.tapQuality = this.tapQuality.concat([quality]).slice(-6);
    const boost = this.boostSteps > 0 ? 2 : 1;
    this.boostSteps = Math.max(0, this.boostSteps - 1);
    this.speed = Math.min(this.maxSpeed(), this.speed + 3.3 * quality * boost);
    this.bounce = 1;
    playSound('hoof');
  }

  handleJump(dt, pressed) {
    if (pressed && this.fallTimer <= 0 && this.jumpHeight <= 0 && this.speed > 1) {
      this.jumpVelocity = 10;
      this.jumpHeight = 0.01;
      playSound('jump');
    }
    if (this.jumpHeight > 0) {
      this.jumpVelocity -= 26 * dt;
      this.jumpHeight += this.jumpVelocity * dt;
      if (this.jumpHeight <= 0) {
        this.jumpHeight = 0;
        this.jumpVelocity = 0;
        this.bounce = 1;
        playSound('land');
      }
    }
  }

  checkObstacleHits() {
    for (const obstacle of this.obstacles) {
      if (obstacle.hit || !this.hits(obstacle)) {
        continue;
      }
      obstacle.hit = true;
      if (this.jumpHeight > 0 && obstacle.kind !== 'fence') {
        continue; // airborne: bushes, logs, ditches, capybaras and lagoons are cleared, but never a fence
      }
      if (obstacle.kind === 'lagoon') {
        this.slowTimer = 1;
        this.lagoonSpeedCap = Math.max(4, this.speed * 0.6);
        this.banner = '¡LAGUNA! TE FRENA';
        this.bannerTimer = 1;
        this.effects.splash = true;
        playSound('splash');
      } else {
        this.fall(FALL_MESSAGES[obstacle.kind]);
      }
    }
  }

  handleLasso(dt, pressed) {
    const lasso = this.lasso;
    const cow = this.cow;
    lasso.cooldown = Math.max(0, lasso.cooldown - dt);
    lasso.timer = Math.max(0, lasso.timer - dt);
    this.lassoBuffer = Math.max(0, this.lassoBuffer - dt);
    if (pressed) {
      this.lassoBuffer = 0.2;
    }
    if (this.fallTimer > 0 || cow.caughtTimer > 0 || lasso.cooldown > 0 || lasso.timer > 0 || this.lassoBuffer <= 0) {
      return;
    }
    this.lassoBuffer = 0;
    lasso.hit = this.canLasso(1); // must be checked before the timer starts, since canLasso requires an idle lasso
    lasso.timer = 0.7;
    lasso.cooldown = lasso.hit ? 0.6 : 1.3;
    setTimeout(() => playSound('lasso'), 140);
    if (lasso.hit) {
      this.catchCow();
      return;
    }
    setTimeout(() => playSound('miss'), 450);
    // missing a bull that is close makes it charge
    if (cow.type === 'bull' && !cow.charge && this.cowGap() < 16 && Math.abs(cow.laneX - this.laneX) < 0.6) {
      cow.charge = { timer: 1.6 };
      this.notify('¡EL TORO EMBISTE!');
      playSound('moo');
    }
  }

  catchCow() {
    const cow = this.cow;
    let points = Math.round(100 * this.level * COW_TYPES[cow.type].points);
    if (cow.type === 'mother' && cow.bonusTimer > 0) {
      points *= 2;
    }
    this.score += points;
    this.cowsCaught++;
    this.effects.caught = points;
    cow.caughtTimer = 1.2;
    setTimeout(() => playSound('catch'), 450);
  }

  updateRider(dt) {
    const pad = this.pad;
    const left = wasPressed(pad.left);
    const right = wasPressed(pad.right);
    const up = wasPressed(pad.up);
    const gallop = wasPressed(pad.b1);
    const lassoPressed = wasPressed(pad.b2);

    if (this.fallTimer <= 0) {
      if (left && this.lane > 0) {
        this.lane--;
        playSound('lane');
      }
      if (right && this.lane < 2) {
        this.lane++;
        playSound('lane');
      }
    }
    this.handleGallopInput(gallop);
    this.handleJump(dt, up);

    this.speed = Math.max(0, this.speed - dt * 4.5);
    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      this.speed = Math.min(this.speed, this.lagoonSpeedCap);
    }
    if (this.fallTimer > 0) {
      this.fallTimer -= dt;
      this.speed = 0;
    }
    this.bannerTimer -= dt;
    const laneSpeed = this.weather.type === 'rain' ? 5 : 10; // the wet ground makes lane changes slow
    this.laneX += (this.lane - 1 - this.laneX) * Math.min(1, laneSpeed * dt);
    this.distance += this.speed * dt;
    this.bounce *= Math.pow(0.02, dt);

    this.checkObstacleHits();
    this.handleLasso(dt, lassoPressed);
  }

  // ----- cow -----

  pickCowType() {
    const roll = Math.random();
    if (this.level >= 3 && roll < 0.18) {
      return 'bull';
    }
    if (this.level >= 2 && roll < 0.33) {
      return 'golden';
    }
    return this.level >= 2 && roll < 0.46 ? 'calf' : 'normal';
  }

  createCow(gap, type) {
    const pos = this.distance + gap;
    const freeLanes = [0, 1, 2].filter((lane) => !this.isBlocked(lane, pos - 4, pos + 14));
    const lanes = freeLanes.length ? freeLanes : [0, 1, 2];
    const lane = lanes[Math.floor(randomBetween(0, lanes.length))];
    const kind = type || this.pickCowType();
    return {
      type: kind,
      lane,
      laneX: lane - 1,
      pos, // meters along the track
      // never above 86% of the horse's top speed, so even a golden cow can be caught with a steady gallop
      speed: Math.min(Math.min(8.5 + this.level * 1.3, 0.8 * this.maxSpeed()) * COW_TYPES[kind].speed, 0.86 * this.maxSpeed()),
      stride: 0, // advances while running, drives the leg animation
      caughtTimer: 0,
      laneTimer: randomBetween(1, 2.5), // time until the next voluntary lane change
      warmupLeft: 2, // the cow starts slowly and builds up to full speed
      warmupStart: 0.4 + 0.5 * Math.min(1, this.speed / this.maxSpeed()),
      bonusTimer: kind === 'mother' ? 8 : 0,
      charge: null,
      tired: 1,
    };
  }

  updateCow(dt) {
    const cow = this.cow;
    cow.stride += dt * cow.speed * 0.9;
    cow.laneX += (cow.lane - 1 - cow.laneX) * Math.min(1, 9 * dt);

    if (cow.caughtTimer > 0) {
      cow.caughtTimer -= dt;
      cow.pos = Math.max(this.distance + MIN_COW_GAP, cow.pos - dt * 6); // the lassoed cow is reeled in
      if (cow.caughtTimer <= 0) {
        this.level++;
        this.cow = cow.type === 'calf' ? this.createCow(15, 'mother') : this.createCow(24 + 12 * Math.min(1, this.speed / this.maxSpeed()));
        playSound('moo');
      }
    } else if (cow.charge) {
      cow.charge.timer -= dt;
      cow.pos -= 22 * dt;
      if (this.cowGap() < 2) {
        this.fall('¡EL TORO TE EMBISTIO!');
        cow.charge = null;
        cow.pos = this.distance + 10;
      } else if (cow.charge.timer <= 0) {
        cow.charge = null;
      }
    } else {
      this.chaseCow(dt);
    }
  }

  chaseCow(dt) {
    const cow = this.cow;
    const gap = this.cowGap();
    cow.tired = gap > 28 ? Math.max(0.3, 1 - (gap - 28) / 30) : 1; // slows down when far ahead
    cow.warmupLeft = Math.max(0, cow.warmupLeft - dt);
    const warmup = this.started ? (cow.warmupLeft > 0 ? cow.warmupStart + (1 - cow.warmupStart) * (1 - cow.warmupLeft / 2) : 1) : 0.15;
    cow.pos = Math.max(this.distance + MIN_COW_GAP, cow.pos + cow.speed * cow.tired * warmup * dt);
    cow.bonusTimer = Math.max(0, cow.bonusTimer - dt);
    cow.laneTimer -= dt;
    this.chooseCowLane(dt, gap);

    if (gap > ESCAPE_DISTANCE && this.started) {
      this.escapeTimer += dt;
      this.warnTimer -= dt;
      if (this.warnTimer <= 0) {
        this.warnTimer = 0.5;
        playSound('warn');
      }
      if (this.escapeTimer >= ESCAPE_SECONDS) {
        if (this.coleo) {
          this.escapeTimer = 0;
          this.cow = this.createCow(26);
          this.notify('¡SE ESCAPO! VIENE OTRA');
        } else {
          this.gameOverMessage = 'SE TE ESCAPO LA VACA';
          playSound('over');
        }
      }
    } else {
      this.escapeTimer = Math.max(0, this.escapeTimer - dt * 0.7);
    }
  }

  // The cow changes lanes now and then, dodges fences and bushes, and runs from the lasso.
  chooseCowLane(dt, gap) {
    const cow = this.cow;
    const lassoThreatens = cow.lane === this.lane && gap <= 13;
    const isBlockedAhead = (lane) => this.isBlocked(lane, cow.pos - 2, cow.pos + cow.speed * 1.2 + 5);
    const blockedNow = isBlockedAhead(cow.lane);
    const veryClose = this.isBlocked(cow.lane, cow.pos - 2, cow.pos + 9);
    const overLagoon = this.obstacles.some((o) => o.kind === 'lagoon' && o.lane === cow.lane && Math.abs(o.pos - cow.pos) < 5);

    // while a lagoon is near the cow stays in its lane so it can jump over it
    const wantsToMove = blockedNow || (!overLagoon && (cow.laneTimer <= 0 || (lassoThreatens && Math.random() < dt * Math.min(2.5, 0.4 + 0.3 * this.level))));
    if (!wantsToMove) {
      return;
    }
    let candidates = [0, 1, 2].filter((lane) => lane !== cow.lane && !isBlockedAhead(lane) && (Math.abs(lane - cow.lane) < 2 || !this.isBlocked(1, cow.pos - 2, cow.pos + 7)));
    if (lassoThreatens && candidates.length > 1) {
      const awayFromRider = candidates.filter((lane) => lane !== this.lane);
      candidates = awayFromRider.length ? awayFromRider : candidates;
    }
    if (!candidates.length && veryClose) {
      candidates = [0, 1, 2].filter((lane) => lane !== cow.lane && !isBlockedAhead(lane));
    }
    if (candidates.length && (blockedNow || Math.random() < 0.6)) {
      cow.lane = candidates[Math.floor(randomBetween(0, candidates.length))];
      cow.laneTimer = randomBetween(1, 3) / Math.sqrt(this.level);
    } else if (!blockedNow) {
      cow.laneTimer = randomBetween(0.6, 1.5);
    }
  }

  // ----- weather: now and then a downpour (low visibility, slippery lane changes) -----

  updateWeather(dt) {
    const weather = this.weather;
    if (weather.type) {
      weather.timer -= dt;
      if (weather.timer <= 0) {
        weather.type = null;
        weather.next = 35 + randomBetween(0, 20);
      }
    } else if (this.started) {
      weather.next -= dt;
      if (weather.next <= 0) {
        weather.type = 'rain';
        weather.timer = 18;
        this.notify('¡AGUACERO!');
        playNoise(0.8, 0.2, undefined, 1500);
      }
    }
  }

  // ----- per-frame update -----

  tick(dt) {
    this.time += dt;
    this.updateRider(dt);
    if (this.coleo) {
      this.timer -= dt;
      if (this.timer <= 0 && !this.gameOverMessage) {
        this.gameOverMessage = 'FIN DEL COLEO';
        playSound('over');
      }
    }
    while (this.nextObstaclePos - this.distance < 90) {
      this.spawnObstacle();
    }
    this.obstacles = this.obstacles.filter((o) => o.pos > this.distance - 10);
    for (const obstacle of this.obstacles) {
      if (obstacle.kind === 'herd') {
        obstacle.x += obstacle.dir * 0.9 * dt; // the capybaras wander back and forth across the road
        if (obstacle.x < -0.6 || obstacle.x > 2.6) {
          obstacle.dir *= -1;
        }
      }
    }
    this.updateCow(dt);
    this.updateWeather(dt);
    this.noticeTimer -= dt;
  }

  // Tutorial hint shown at the bottom of the screen; '' when there is nothing to teach.
  hint() {
    const hints = this.hints;
    if (!this.started) {
      return 'PULSA ' + this.keys.gallop + ' A RITMO PARA GALOPAR';
    }
    hints.lasso = hints.lasso || this.lasso.timer > 0 || this.cowsCaught > 0;
    hints.jump = hints.jump || this.jumpHeight > 0;
    const threat = this.obstacles.find((o) => !o.hit && o.kind !== 'lagoon' && o.pos - this.distance > 0 && o.pos - this.distance < 40 && Math.abs(this.laneX - this.obstacleLaneX(o)) < (o.kind === 'ditch' ? 1 : 0.5));
    const teach = (name, frames) => {
      hints[name + 'Frames'] = (hints[name + 'Frames'] || 0) + 1;
      hints[name] = hints[name + 'Frames'] > frames;
    };
    if (threat) {
      const isFence = threat.kind === 'fence';
      const name = isFence ? 'lane' : 'jump';
      if (!hints[name]) {
        teach(name, 100);
        return isFence ? 'JOYSTICK ← →  ESQUIVA LA CERCA' : 'JOYSTICK ↑  SALTA  (o ← → ESQUIVA)';
      }
    }
    if (!hints.lasso && this.canLasso()) {
      teach('lasso', 90);
      return '¡' + this.keys.lasso + '  LANZA EL LAZO!';
    }
    return '';
  }
}

// ---------- chase scene: the pseudo-3D view from behind the rider ----------

const ROPE_COLOR = 0xd8b36c;
const LANE_WIDTH = 150; // pixels between lanes at the rider's depth
const DECOR_KINDS = [['palm', 7, 2.6, 5], ['tree', 6, 2.4, 5], ['bush', 5, 2, 4], ['tuft', 4, 1.9, 4.5], ['tuft', 4, 1.9, 4.5]];

// Two instances run side by side in the 2-player coleo: key 'chase' (left half) and 'chase2' (right half).
class ChaseScene extends Phaser.Scene {
  constructor(key) {
    super(key);
  }

  create(data) {
    makeTextures(this);
    this.options = data || {};
    this.split = this.options.mode === '2p';
    this.side = this.options.side || 0;
    this.uiScale = this.split ? 1.25 : 1; // texts are bigger in split screen to offset the camera zoom
    this.left = this.split ? 160 : 20;
    this.right = this.split ? 640 : GAME_WIDTH - 20;
    this.elapsed = 0;
    this.isGameOver = false;
    this.particles = [];
    this.lastLevel = 1;
    this.bestScore = store.get(BEST_SCORE_KEY) || 0;
    this.centerX = CENTER_X;
    this.obstacleImages = new Map();

    this.pads = [createPad('P1'), createPad('P2')];
    const woman = this.split && this.side === 1; // the second player rides as a woman
    const keys = woman ? { gallop: 'B1 (R)', lasso: 'B2 (T)' } : { gallop: 'B1 (U)', lasso: 'B2 (I)' };
    this.race = new Race(this.pads[woman ? 1 : 0], this.split, keys);

    this.world = this.add.graphics().setDepth(0); // sky, ground, shadows and lagoons
    this.overlay = this.add.graphics().setDepth(250); // lasso, weather and the HUD meters

    this.buildScenery();
    this.cowImage = this.add.image(0, 0, 'cow0').setOrigin(0.5, 1);
    this.horseKey = woman ? 'horseF' : 'horse';
    this.riderImage = this.add.image(400, 575, this.horseKey + '0').setOrigin(0.5, 1).setScale(4.2).setDepth(200);
    this.hatImage = this.add.image(0, 0, woman ? 'hatF' : 'hat').setScale(4).setDepth(205).setVisible(false);

    if (this.split) {
      this.cameras.main.setViewport(this.side * 400, 60, 400, 480).setZoom(0.8).centerOn(GAME_WIDTH / 2, GAME_HEIGHT / 2);
      this.makeText(GAME_WIDTH / 2, 44, woman ? 'J2' : 'J1', FONT_PIXEL, 14, woman ? '#ffb0d0' : '#39ff88').setOrigin(0.5).setDepth(300);
    }
    this.add.image(this.left + 6, 18, 'cow0').setScale(1.6 * this.uiScale).setDepth(301);
    this.hudText = this.makeText(this.left + 26 * this.uiScale, 9, '', FONT_MONO, 15, UI_CREAM).setDepth(300);
    this.musicText = this.makeText(GAME_WIDTH - 12, 8, '', FONT_MONO, 14, UI_CREAM).setOrigin(1, 0).setDepth(300);
    // notices and hints sit in the sky so they never cover the cow or the obstacles coming down the road
    this.bannerText = this.makeText(GAME_WIDTH / 2, 80, '', FONT_PIXEL, 13, '#ff9a6a', { align: 'center', ...this.textBox() }).setOrigin(0.5).setDepth(305);
    this.hintText = this.makeText(GAME_WIDTH / 2, 128, '', FONT_PIXEL, 12, '#ffe08a', { align: 'center', ...this.textBox() }).setOrigin(0.5).setDepth(305);
    this.rhythmText = this.makeText(this.left, GAME_HEIGHT - 34 * this.uiScale, '', FONT_PIXEL, 10, UI_CREAM).setOrigin(0, 1).setDepth(300);
    this.cowLabel = this.makeText(0, 0, '', FONT_PIXEL, 9, '#ffe14d').setOrigin(0.5, 1).setDepth(281);
    this.endText = this.makeText(GAME_WIDTH / 2, GAME_HEIGHT / 2, '', FONT_PIXEL, 15, UI_CREAM, { align: 'center', lineSpacing: 12, backgroundColor: 'rgba(42,18,8,0.88)', padding: { x: 24, y: 20 } })
      .setOrigin(0.5)
      .setDepth(310)
      .setVisible(false);
  }

  makeText(x, y, content, fontFamily, size, color, extra) {
    return this.add.text(x, y, content, { fontFamily, fontSize: Math.round(size * this.uiScale) + 'px', color, stroke: UI_STROKE, strokeThickness: 3, ...extra });
  }

  textBox() {
    return { backgroundColor: 'rgba(42,18,8,0.78)', padding: { x: 12, y: 8 } };
  }

  // Trees, fence posts, clouds and the far tree line that scroll past.
  buildScenery() {
    this.decor = [];
    for (let i = 0; i < 64; i++) {
      const [key, scale, minX, maxX] = DECOR_KINDS[Math.floor(randomBetween(0, DECOR_KINDS.length))];
      const image = this.add.image(0, 0, key).setOrigin(0.5, 1).setDepth(1);
      this.decor.push({ pos: i * 4 + randomBetween(0, 3), lateral: (i % 2 ? 1 : -1) * randomBetween(minX, maxX), scale, image });
    }
    this.posts = [];
    for (let i = 0; i < 60; i++) {
      this.posts.push({ pos: i * 4, side: i % 2 ? 1 : -1, image: this.add.image(0, 0, 'post').setOrigin(0.5, 1).setDepth(1) });
    }
    this.clouds = [];
    for (let i = 0; i < 6; i++) {
      this.clouds.push({ x: randomBetween(0, GAME_WIDTH), y: randomBetween(40, 150), width: randomBetween(60, 150) });
    }
    this.treeLine = [];
    for (let i = 0; i < 42; i++) {
      this.treeLine.push({ x: i * 20 + randomBetween(-6, 6), width: randomBetween(12, 30), height: randomBetween(4, 12) });
    }
  }

  // ----- perspective: z is meters ahead of the rider -----

  scaleAt(z) {
    return 5 / (5 + Math.max(z, -4.5));
  }

  screenY(z) {
    return 230 + 370 * this.scaleAt(z);
  }

  screenX(lateral, z) {
    return this.centerX + lateral * LANE_WIDTH * this.scaleAt(z);
  }

  riderX() {
    return this.centerX + this.race.laneX * LANE_WIDTH;
  }

  // ----- frame loop -----

  update(time, delta) {
    const dt = Math.min(delta / 1000, 0.05);
    const race = this.race;
    const isMain = !this.split || this.side === 0;
    if (this.isGameOver) {
      if (anyWasPressed(this.pads, 'start')) {
        this.scene.restart(this.options);
      } else if (anyWasPressed(this.pads, 'b6') && isMain) {
        if (this.split) {
          this.scene.stop('chase2');
        }
        this.scene.start('menu');
      }
    } else {
      this.elapsed += dt;
      this.tick(dt);
    }
    if (isMain) {
      if (anyWasPressed(this.pads, 'b5')) {
        music.toggle();
        playTone(music.enabled ? 880 : 330, 0.08, 'square', 0.05);
      }
      if (anyWasPressed(this.pads, 'b4')) {
        music.nextSong();
      }
      music.level = race.level - 1;
      music.update([race], this.isGameOver, dt);
    }
    if (this.split) {
      coleoScores[this.side] = race.points();
    }
    this.world.clear();
    this.overlay.clear();
    this.draw();
    this.updateTexts();
  }

  tick(dt) {
    const race = this.race;
    race.tick(dt);
    this.stepParticles(dt);
    if (race.effects.caught) {
      this.onCatch(race.effects.caught);
      race.effects.caught = 0;
    }
    if (race.effects.fall) {
      race.effects.fall = false;
      this.dust(this.riderX(), 575, 18, 40);
    }
    if (race.effects.splash) {
      race.effects.splash = false;
      for (let i = 0; i < 22; i++) {
        this.particles.push({ x: this.riderX() + randomBetween(-30, 30), y: 572, vx: randomBetween(-120, 120), vy: randomBetween(-220, -60), life: randomBetween(0.4, 0.9), color: i % 2 ? 0x4aa3df : 0xbfe6fb });
      }
    }
    if (race.level !== this.lastLevel) {
      this.lastLevel = race.level;
      this.showLevelBanner(race.level);
    }
    if (race.gameOverMessage) {
      this.finish();
    }
  }

  showLevelBanner(level) {
    const banner = this.makeText(GAME_WIDTH + 200, 80, 'NIVEL ' + level + '\nvaca mas rapida', FONT_PIXEL, 18, UI_CREAM, { align: 'center', backgroundColor: 'rgba(42,18,8,0.78)', padding: { x: 20, y: 12 } })
      .setOrigin(0.5)
      .setDepth(290);
    this.tweens.add({ targets: banner, x: GAME_WIDTH / 2, duration: 350, ease: 'Back.easeOut' });
    this.tweens.add({ targets: banner, x: -200, delay: 1500, duration: 350, ease: 'Back.easeIn', onComplete: () => banner.destroy() });
    playTone(660, 0.1, 'square', 0.06);
    setTimeout(() => playTone(990, 0.15, 'square', 0.06), 120);
  }

  finish() {
    if (this.isGameOver) {
      return;
    }
    const race = this.race;
    const lines = [];
    if (this.split) {
      const mine = race.points();
      const rival = coleoScores[1 - this.side] || 0;
      lines.push('TU  x' + race.cowsCaught + '  ' + mine + ' pts', 'RIVAL  ' + rival + ' pts', '', mine === rival ? 'EMPATE' : mine > rival ? '¡GANAS!' : 'PIERDES');
    } else {
      const points = race.points();
      const isRecord = points > this.bestScore;
      if (isRecord) {
        store.set(BEST_SCORE_KEY, points);
      }
      lines.push(
        'VACAS ENLAZADAS  ' + race.cowsCaught,
        'NIVEL  ' + race.level,
        'DISTANCIA  ' + Math.floor(race.distance) + ' m',
        'CAIDAS  ' + race.fallCount,
        'PUNTOS  ' + points,
        '',
        isRecord ? 'NUEVO RECORD' : 'record ' + this.bestScore,
      );
    }
    this.isGameOver = true;
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x1a0818, 0.45).setDepth(309);
    this.endText.setVisible(true).setText(race.gameOverMessage + '\n\n' + lines.join('\n') + '\n\nSTART: otra vez    B6: menu');
  }

  // ----- effects -----

  onCatch(points) {
    const cow = this.race.cow;
    const gap = this.race.cowGap();
    const x = this.screenX(cow.laneX, gap);
    const y = this.screenY(gap) - 20;
    for (const color of [0xffe14d, 0xff3d81, 0x39ff88, 0x38c6ff, 0xffffff]) {
      this.burst(x, y, 8, color);
    }
    const score = this.makeText(x, y - 30, '+' + points + '\n¡ENLAZADA!', FONT_PIXEL, 16, '#ffe14d', { align: 'center', strokeThickness: 4 }).setOrigin(0.5).setDepth(280);
    this.tweens.add({ targets: score, y: y - 120, alpha: 0, duration: 1300, ease: 'Cubic.easeOut', onComplete: () => score.destroy() });
  }

  burst(x, y, count, color) {
    for (let i = 0; i < count; i++) {
      const angle = randomBetween(0, Math.PI * 2);
      const speed = randomBetween(40, 220);
      this.particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: randomBetween(0.3, 0.8), color });
    }
  }

  dust(x, y, count, spread) {
    for (let i = 0; i < count; i++) {
      this.particles.push({ x: x + randomBetween(-spread, spread), y: y + randomBetween(-6, 4), vx: randomBetween(-90, 90), vy: randomBetween(-60, -10), life: randomBetween(0.5, 1.1), color: i % 3 ? 0xd8b36c : 0xf0dca8 });
    }
  }

  stepParticles(dt) {
    for (const particle of this.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.life -= dt;
    }
    this.particles = this.particles.filter((particle) => particle.life > 0);
  }

  // ----- drawing -----

  draw() {
    const race = this.race;
    this.centerX = 400 - race.laneX * 40; // the camera leans with the rider
    this.drawSky();
    this.drawGround();
    this.drawScenery();
    this.drawObstacles();
    this.drawCow();
    this.drawRider();
    this.drawWeather();
    if (race.fallTimer > 0) {
      this.overlay.fillStyle(0xff3d81, race.fallTimer * 0.2).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    }
    if (race.slowTimer > 0) {
      this.overlay.fillStyle(0x4aa3df, 0.15).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
    }
    for (const particle of this.particles) {
      this.overlay.fillStyle(particle.color, Math.min(1, particle.life * 2)).fillRect(particle.x - 2, particle.y - 2, 4, 4);
    }
    this.drawBars();
  }

  // How far the day has turned into sunset: starts at golden hour and deepens with the level, never dark.
  dusk() {
    return 0.35 + 0.4 * Math.min(1, (this.race.level - 1) / 6);
  }

  drawSky() {
    const world = this.world;
    const t = this.dusk();
    const mix = (day, dusk) => mixColors(day, dusk, t);
    world.fillStyle(mix(0x4f9fdc, 0x7a8fd8), 1).fillRect(0, 0, GAME_WIDTH, 80);
    world.fillStyle(mix(0x6ebbea, 0xe58aa0), 1).fillRect(0, 80, GAME_WIDTH, 70);
    world.fillStyle(mix(0x9bd4f3, 0xffb070), 1).fillRect(0, 150, GAME_WIDTH, 50);
    world.fillStyle(mix(0xd8eefb, 0xffd89a), 1).fillRect(0, 200, GAME_WIDTH, 35);

    const sunY = 90 + t * 110;
    const sunColor = mix(0xffe680, 0xff9a3a);
    world.fillStyle(sunColor, 1).fillCircle(640, sunY, 34 + t * 10);
    world.fillStyle(sunColor, 0.45).fillCircle(640, sunY, 46 + t * 12);
    world.fillStyle(sunColor, 0.2).fillCircle(640, sunY, 62 + t * 16);

    for (const cloud of this.clouds) {
      cloud.x -= 0.15 + this.race.speed * 0.02;
      if (cloud.x < -cloud.width) {
        cloud.x = GAME_WIDTH + cloud.width;
      }
      world.fillStyle(mix(0xffffff, 0xfff0e0), 0.92);
      world.fillCircle(cloud.x, cloud.y, cloud.width * 0.25);
      world.fillCircle(cloud.x + cloud.width * 0.3, cloud.y - 8, cloud.width * 0.3);
      world.fillCircle(cloud.x + cloud.width * 0.6, cloud.y, cloud.width * 0.22);
    }
    // far tree line scrolling slowly
    world.fillStyle(0x35592a, 1);
    for (const tree of this.treeLine) {
      const x = ((((tree.x - this.race.distance * 0.25) % (GAME_WIDTH + 40)) + GAME_WIDTH + 40) % (GAME_WIDTH + 40)) - 20;
      world.fillEllipse(x, 232, tree.width, tree.height * 2);
    }
  }

  drawGround() {
    const world = this.world;
    const t = this.dusk();
    const grassA = mixColors(0x6fae3e, 0x9a9a3a, t * 0.5);
    const grassB = mixColors(0x76b645, 0xa49a42, t * 0.5);
    const distance = this.race.distance;
    world.fillStyle(grassA, 1).fillRect(0, 232, GAME_WIDTH, GAME_HEIGHT - 232);
    world.fillStyle(mixColors(0x8cc45a, 0xc0b050, t * 0.5), 1).fillRect(0, 232, GAME_WIDTH, 6);
    world.fillStyle(0xfff0d0, 0.35).fillRect(0, 236, GAME_WIDTH, 10);
    world.fillStyle(0xfff0d0, 0.18).fillRect(0, 246, GAME_WIDTH, 14);

    // grass stripes and the sandy road, drawn as bands that grow toward the camera
    for (let k = 0; k < 70; k++) {
      const z = k * 2 - (distance % 2);
      if (z < -1) {
        continue;
      }
      const y = this.screenY(z);
      const height = Math.max(1, this.screenY(z - 2) - y + 1);
      const scale = this.scaleAt(z);
      world.fillStyle(k % 2 ? grassB : grassA, 1).fillRect(0, y, GAME_WIDTH, height);
      world.fillStyle(0xd8b87c, 1).fillRect(this.centerX - 240 * scale, y, 480 * scale, height);
      world.fillStyle(0xc39d60, 0.9).fillRect(this.centerX - 240 * scale, y - 1, 480 * scale, Math.max(1, 2.5 * scale));
    }
    for (let lane = 0; lane < 3; lane++) {
      for (const offset of [-0.5, 0.5]) {
        const lateral = lane - 1 + offset;
        world.lineStyle(2, 0xf0e0b0, 0.5).lineBetween(this.screenX(lateral, 0), GAME_HEIGHT, this.screenX(lateral, 260), this.screenY(260));
      }
    }
  }

  // Visibility fades with distance in the rain.
  visibility(z) {
    return this.race.weather.type === 'rain' ? Math.max(0.15, 1 - z / 45) : 1;
  }

  drawScenery() {
    const world = this.world;
    const distance = this.race.distance;
    for (const item of this.decor) {
      let z = item.pos - distance;
      if (z < -4) {
        item.pos += 256;
        z = item.pos - distance;
      }
      const scale = this.scaleAt(z);
      item.image
        .setPosition(this.screenX(item.lateral, z), this.screenY(z))
        .setScale(item.scale * scale)
        .setDepth(1 + Math.max(0, 100 - z))
        .setVisible(z < 240)
        .setAlpha(Math.min(1, this.visibility(z)));
    }
    for (const post of this.posts) {
      let z = post.pos - distance;
      if (z < -12) {
        post.pos += 240;
        z = post.pos - distance;
      }
      const scale = this.scaleAt(z);
      post.image
        .setPosition(this.screenX(post.side * 1.72, z), this.screenY(z))
        .setScale(5 * scale)
        .setDepth(1 + Math.max(0, 100 - z))
        .setVisible(z < 240 && z > -4);
      if (post.side === 1 && z < 120) {
        // two rails of the fence along the road
        const farZ = z + 8;
        const farScale = this.scaleAt(farZ);
        for (const rail of [26, 14]) {
          for (const side of [1, -1]) {
            world.lineStyle(Math.max(1, 2.5 * scale), 0x8a5a30, 0.9);
            world.lineBetween(this.screenX(side * 1.72, z), this.screenY(z) - rail * scale, this.screenX(side * 1.72, farZ), this.screenY(farZ) - rail * farScale);
          }
        }
      }
    }
  }

  drawObstacles() {
    const world = this.world;
    const race = this.race;
    const visible = new Set();
    for (const obstacle of race.obstacles) {
      const z = obstacle.pos - race.distance;
      if (z < -3.5) {
        continue;
      }
      visible.add(obstacle);
      const scale = this.scaleAt(z);
      const y = this.screenY(z);
      const depth = 110 - z;
      const alpha = Math.min(1, this.visibility(Math.max(0, z)));

      if (obstacle.kind === 'lagoon') {
        this.drawLagoon(obstacle, z, scale, y, depth, alpha);
      } else if (obstacle.kind === 'ditch') {
        const x0 = this.screenX(obstacle.lane - 1.5, z);
        const x1 = this.screenX(obstacle.lane + 0.5, z);
        const farY = this.screenY(z + 1.2);
        const x0Far = this.screenX(obstacle.lane - 1.5, z + 1.2);
        const x1Far = this.screenX(obstacle.lane + 0.5, z + 1.2);
        world.fillStyle(0x3a2a14, alpha);
        world.beginPath();
        world.moveTo(x0, y);
        world.lineTo(x1, y);
        world.lineTo(x1Far, farY);
        world.lineTo(x0Far, farY);
        world.closePath();
        world.fillPath();
        world.fillStyle(0x6b4a2b, 0.8 * alpha).fillRect(x0, y - 2 * scale, x1 - x0, 3 * scale);
        world.fillStyle(0x2b6fa8, 0.7 * alpha).fillRect(x0Far + (x0 - x0Far) * 0.3, farY - (farY - y) * 0.35, (x1Far - x0Far) * 0.7, (farY - y) * 0.25);
      } else if (obstacle.kind === 'herd') {
        let group = this.obstacleImages.get(obstacle);
        if (!group) {
          group = [0, 1, 2].map(() => this.add.image(0, 0, 'chig').setOrigin(0.5, 1));
          this.obstacleImages.set(obstacle, group);
        }
        group.forEach((image, k) => {
          image
            .setPosition(this.screenX(obstacle.x - 1 + (k - 1) * 0.28, z), y - (k % 2) * 3 * scale)
            .setScale(4 * scale)
            .setDepth(depth + k * 0.1)
            .setAlpha(alpha)
            .setFlipX(obstacle.dir < 0);
        });
      } else {
        const x = this.screenX(obstacle.lane - 1, z);
        const width = obstacle.kind === 'fence' ? 150 : obstacle.kind === 'log' ? 140 : 90;
        world.fillStyle(0x3a2610, 0.22 * alpha).fillEllipse(x, y, width * scale, 20 * scale);
        let image = this.obstacleImages.get(obstacle);
        if (!image) {
          image = this.add.image(0, 0, obstacle.kind).setOrigin(0.5, 1);
          this.obstacleImages.set(obstacle, image);
        }
        const size = obstacle.kind === 'fence' ? 7 : obstacle.kind === 'log' ? 6.5 : 6;
        image.setPosition(x, y).setScale(Math.max(obstacle.kind === 'bush' ? 1.3 : 1.6, size * scale)).setDepth(depth).setAlpha(alpha);
      }
    }
    for (const [obstacle, image] of this.obstacleImages) {
      if (!visible.has(obstacle)) {
        (Array.isArray(image) ? image : [image]).forEach((part) => part.destroy());
        this.obstacleImages.delete(obstacle);
      }
    }
  }

  // A mirror of sky with ripples; drawn on the ground layer so a jumping cow covers it.
  drawLagoon(obstacle, z, scale, y, depth, alpha) {
    const world = this.world;
    const x = this.screenX(obstacle.lane - 1, z);
    world.fillStyle(0x4aa3df, 0.9 * alpha).fillEllipse(x, y - 4 * scale, 130 * scale, 34 * scale);
    world.fillStyle(0xffd890, 0.6 * alpha).fillEllipse(x - 20 * scale, y - 8 * scale, 40 * scale, 8 * scale);
    const ripple = (this.elapsed * 0.7 + obstacle.pos * 0.1) % 1;
    world.lineStyle(1, 0xffffff, 0.5 * (1 - ripple) * alpha).strokeEllipse(x + 10 * scale, y - 4 * scale, (20 + 80 * ripple) * scale, (5 + 20 * ripple) * scale);
  }

  drawCow() {
    const world = this.world;
    const overlay = this.overlay;
    const race = this.race;
    const cow = race.cow;
    const gap = race.cowGap();
    const scale = this.scaleAt(gap);
    const x = this.screenX(cow.laneX, gap);
    const y = this.screenY(gap);
    const isBull = cow.type === 'bull';
    const sizeFactor = isBull ? 1.25 : cow.type === 'calf' ? 0.65 : 1;
    const struggling = cow.caughtTimer > 0;
    if (race.canLasso()) {
      this.overlay.lineStyle(3, 0x7aff9a, 0.55 + 0.45 * Math.sin(this.elapsed * 12)).strokeEllipse(x, y - 22 * scale, 90 * scale, 60 * scale);
    }

    // jump arc while crossing a lagoon: 0 on the ground, 1 at the peak
    const lagoon = race.obstacles.find((o) => o.kind === 'lagoon' && o.lane === cow.lane && Math.abs(o.pos - cow.pos) < 3.2);
    const jump = lagoon ? Math.sin(Math.PI * (1 - (lagoon.pos - cow.pos + 3.2) / 6.4)) : 0;

    world.fillStyle(0x3a2610, 0.25).fillEllipse(x, y, 60 * scale * (isBull ? 1.3 : cow.type === 'calf' ? 0.7 : 1), 16 * scale);
    const frame = Math.floor(this.elapsed) % 4 === 3 && this.elapsed % 1 < 0.5 ? 2 : Math.floor(cow.stride) % 2; // blinks now and then
    const visibility = Math.min(1, this.visibility(gap) + 0.3);
    this.cowImage
      .setTexture(isBull ? 'toro' : (cow.type === 'golden' ? 'cowG' : 'cow') + frame)
      .setPosition(x, y - (Math.floor(cow.stride * 2) % 2) * 3 * scale - jump * 40 * scale)
      .setScale(Math.max(1.7, 5.5 * scale) * sizeFactor * (1 + 0.3 * jump))
      .setDepth(110 - gap)
      .setAngle(struggling ? Math.sin(this.elapsed * 30) * 20 : cow.charge ? Math.sin(this.elapsed * 40) * 6 : 0)
      .setAlpha((struggling ? 0.5 + 0.5 * Math.abs(Math.sin(this.elapsed * 12)) : 1) * Math.max(0.35, 1 - gap / 90) * visibility);

    const label = cow.charge ? '¡EMBISTE!' : cow.type === 'mother' ? (cow.bonusTimer > 0 ? 'MAMA x2 ' + Math.ceil(cow.bonusTimer) + 's' : 'MAMA') : COW_TYPES[cow.type].label;
    this.cowLabel.setText(label).setPosition(x, y - 80 * scale - 6).setVisible(!!label && !struggling).setColor(isBull ? '#ff7a8a' : '#ffe14d');
    if (!struggling && cow.tired < 0.95) {
      // sweat puffs: the cow is tired
      const k = (this.elapsed * 1.5) % 1;
      overlay.fillStyle(0xffffff, 0.6 * (1 - k));
      overlay.fillCircle(x + (10 + k * 18) * scale, y - (30 + k * 14) * scale, (4 + k * 8) * scale);
      overlay.fillCircle(x + (16 + k * 14) * scale, y - (24 + k * 10) * scale, (3 + k * 5) * scale);
    }
    if (!struggling && gap > 15) {
      // an arrow above a far cow: yellow when close, pink when about to escape
      const arrowY = y - 70 * scale - 70 + Math.sin(this.elapsed * 6) * 5;
      const color = gap > ESCAPE_DISTANCE ? 0xff3d81 : 0xffe14d;
      overlay.fillStyle(color, 0.95).fillTriangle(x - 9, arrowY - 14, x + 9, arrowY - 14, x, arrowY);
      overlay.lineStyle(1, color, 0.5).lineBetween(x, arrowY, x, y - 62 * scale);
    }
  }

  drawRider() {
    const world = this.world;
    const overlay = this.overlay;
    const race = this.race;
    const cow = race.cow;
    const x = this.riderX();
    const lift = race.jumpHeight * 60;
    const cowGap = race.cowGap();
    const cowScale = this.scaleAt(cowGap);
    const cowX = this.screenX(cow.laneX, cowGap);
    const cowY = this.screenY(cowGap);

    // speed lines at high speed
    const speedFraction = race.speed / race.maxSpeed();
    if (speedFraction > 0.8 && race.fallTimer <= 0) {
      overlay.lineStyle(2, 0xffffff, (speedFraction - 0.8) * 2.5);
      for (let i = 0; i < 8; i++) {
        const angle = ((i * 0.8 + this.elapsed * 9) % 6.4) - 3.2;
        const inner = 120 + ((this.elapsed * 700 + i * 90) % 300);
        overlay.lineBetween(this.centerX + Math.cos(angle) * inner, 235 + Math.sin(angle) * inner * 0.8, this.centerX + Math.cos(angle) * (inner + 60), 235 + Math.sin(angle) * (inner + 60) * 0.8);
      }
    }

    // shadow shrinks while jumping; a ring pulses on each gallop beat
    world.fillStyle(0x3a2610, 0.28 - Math.min(0.2, race.jumpHeight * 0.1)).fillEllipse(x, 577, 70 - race.jumpHeight * 15, 18 - race.jumpHeight * 4);
    if (race.bounce > 0.05 && race.jumpHeight <= 0) {
      world.lineStyle(3, 0xffffff, race.bounce * 0.8).strokeEllipse(x, 578, 40 + 90 * (1 - race.bounce), 12 + 26 * (1 - race.bounce));
    }

    const airborne = race.jumpHeight > 0;
    const frame = airborne ? 2 : race.speed > 1 ? [0, 1, 2, 1][Math.floor(this.elapsed * Math.max(5, race.speed * 0.9)) % 4] : 1;
    let angle = airborne ? -8 : (race.lane - 1 - race.laneX) * -12;
    if (race.fallTimer > 0) {
      angle = race.fallTimer > 0.9 ? (0.9 - race.fallTimer) * -800 : -75; // flips over, then lies sideways
    }
    this.riderImage
      .setTexture(this.horseKey + frame)
      .setPosition(x, 575 - lift - race.bounce * 18 - (race.speed > 1 && !airborne ? Math.abs(Math.sin(this.elapsed * race.speed * 0.9)) * 8 : 0))
      .setAngle(angle);
    if (race.speed > 6 && !airborne && Math.random() < race.speed / 14) {
      this.particles.push({ x: x + randomBetween(-26, 26), y: 578, vx: randomBetween(-30, 30), vy: randomBetween(20, 80), life: randomBetween(0.3, 0.6), color: 0xd8b36c });
    }

    // the hat flies off when the rider falls
    this.hatImage.setVisible(race.fallTimer > 0);
    if (race.fallTimer > 0) {
      const k = 1 - race.fallTimer / FALL_SECONDS;
      this.hatImage.setPosition(x + 40 + 90 * k, 470 - 120 * Math.sin(Math.min(1, k * 1.4) * Math.PI) + 40 * k).setAngle(k * 720);
      world.fillStyle(0xe8d8b0, 0.55 * (1 - k)).fillEllipse(x, 575, 120 + 160 * k, 40 + 30 * k);
      for (let q = 0; q < 3; q++) {
        const a = this.elapsed * 7 + q * 2.1;
        const sx = x + Math.cos(a) * 34;
        const sy = 470 + Math.sin(a) * 10;
        overlay.fillStyle(0xffe14d, 1);
        overlay.fillTriangle(sx - 6, sy + 3, sx + 6, sy + 3, sx, sy - 8);
        overlay.fillTriangle(sx - 6, sy - 3, sx + 6, sy - 3, sx, sy + 8);
      }
    }
    this.drawLasso(x, 438 - lift, cowX, cowY, cowScale, lift);
  }

  drawLasso(x, handY, cowX, cowY, cowScale, lift) {
    const overlay = this.overlay;
    const race = this.race;
    const lasso = race.lasso;
    const handX = x + 26;
    const gap = race.cowGap();

    // a hit flies to the cow; a miss falls short, ahead of the horse
    let targetX;
    let targetY;
    let radius;
    if (lasso.hit) {
      targetX = cowX;
      targetY = cowY - 28 * cowScale;
      radius = Math.max(10, 22 * cowScale);
    } else {
      const missZ = gap > LASSO_MAX_RANGE ? LASSO_MAX_RANGE * 0.7 : Math.max(4, gap);
      targetX = this.screenX(race.laneX, missZ);
      targetY = this.screenY(missZ) - 6;
      radius = Math.max(8, 20 * this.scaleAt(missZ));
    }
    if (lasso.timer > 0) {
      const t = 0.7 - lasso.timer;
      if (t < 0.15) {
        // winding up
        const a = t * 45;
        const loopX = x + Math.cos(a) * 14;
        const loopY = 396 - lift + Math.sin(a) * 5;
        this.drawRope(handX, handY, loopX, loopY, -6, 2);
        overlay.lineStyle(3, ROPE_COLOR, 1).strokeEllipse(loopX, loopY, 48, 14);
      } else if (t < 0.45) {
        // flying out
        const p = (t - 0.15) / 0.3;
        const endX = handX + (targetX - handX) * p;
        const endY = handY + (targetY - handY) * p - Math.sin(p * Math.PI) * 70;
        this.drawRope(handX, handY, endX, endY, 18 * (1 - p));
        overlay.lineStyle(4, ROPE_COLOR, 1).strokeEllipse(endX, endY, Math.max(10, radius * 2.2 * (0.4 + 0.6 * p)), Math.max(6, radius * 1.4 * (0.4 + 0.6 * p)));
      } else {
        // landing: tightens on the cow, or fades on a miss
        const p = (t - 0.45) / 0.25;
        if (lasso.hit) {
          this.drawRope(handX, handY, targetX, targetY, 10);
          overlay.lineStyle(4, ROPE_COLOR, 1).strokeEllipse(targetX, targetY, radius * 2.2 * (1 - 0.45 * p), radius * 1.4 * (1 - 0.45 * p));
        } else {
          const endY = targetY + p * 14;
          this.drawRope(handX, handY, targetX, endY, 26, 3);
          overlay.lineStyle(3, ROPE_COLOR, 1 - p * 0.7).strokeEllipse(targetX, endY, radius * 2.2, radius * 0.9 * (1 - p * 0.6));
        }
      }
    } else if (race.cow.caughtTimer > 0) {
      this.drawRope(handX, handY, cowX, cowY - 28 * cowScale, 10 + Math.sin(this.elapsed * 25) * 4);
      overlay.lineStyle(4, ROPE_COLOR, 1).strokeEllipse(cowX, cowY - 28 * cowScale, Math.max(10, 22 * cowScale) * 1.3, Math.max(10, 22 * cowScale) * 0.8);
    } else if (lasso.cooldown <= 0 && race.canLasso()) {
      // ready: the loop spins beside the rider
      const a = this.elapsed * 14;
      const loopX = x + Math.cos(a) * 10;
      const loopY = 398 - lift + Math.sin(a) * 3;
      this.drawRope(handX, handY, loopX, loopY, -4, 2);
      overlay.lineStyle(2, ROPE_COLOR, 0.9).strokeEllipse(loopX, loopY, 34, 10);
    }
  }

  drawRope(x1, y1, x2, y2, sag, width = 3) {
    const overlay = this.overlay;
    overlay.lineStyle(width, ROPE_COLOR, 1);
    overlay.beginPath();
    overlay.moveTo(x1, y1);
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      overlay.lineTo(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t + Math.sin(t * Math.PI) * sag);
    }
    overlay.strokePath();
  }

  drawWeather() {
    const overlay = this.overlay;
    const weather = this.race.weather;
    if (weather.type === 'rain') {
      overlay.fillStyle(0x6f86a0, 0.18).fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      overlay.lineStyle(1, 0xd8eefb, 0.45);
      for (let i = 0; i < 60; i++) {
        const x = ((i * 53 + this.elapsed * 600) % (GAME_WIDTH + 40)) - 20;
        const y = ((i * 97 + this.elapsed * 900) % (GAME_HEIGHT + 40)) - 20;
        overlay.lineBetween(x, y, x - 5, y + 16);
      }
    }
  }

  // Top panel, escape meter and the speed meter.
  drawBars() {
    const race = this.race;
    const overlay = this.overlay;
    const scale = this.uiScale;
    drawPanel(overlay, 6, 3, GAME_WIDTH - 12, 30, 0.55);

    if (race.escapeTimer > 0 || race.cowGap() > ESCAPE_DISTANCE) {
      drawMeter(overlay, GAME_WIDTH / 2 - 120, 40, 240, 14, race.escapeTimer / ESCAPE_SECONDS, 0xff4a5a);
    }
    const speedFraction = race.speed / race.maxSpeed();
    const speedColor = race.fallTimer > 0 ? 0xff4a5a : speedFraction > 0.85 ? 0x7aff9a : 0xffc04a;
    drawMeter(overlay, this.left, GAME_HEIGHT - 28 * scale, 160 * scale, 12 * scale, speedFraction, speedColor);
  }

  updateTexts() {
    const race = this.race;
    const gap = race.cowGap();
    if (this.split) {
      this.hudText.setText('x' + race.cowsCaught + '  ' + race.points() + ' pts  ⏱' + Math.max(0, Math.ceil(race.timer)) + '  ' + Math.round(gap) + ' m' + (race.canLasso() ? ' ¡TIRA!' : ''));
    } else {
      this.hudText.setText('x' + race.cowsCaught + '  NIV ' + race.level + '  PTS ' + race.points() + '  VACA ' + Math.round(gap) + ' m' + (race.canLasso() ? ' ¡A TIRO!' : '') + '  ' + Math.round(race.speed * 3.6) + ' km/h');
      this.musicText.setText(music.enabled ? (music.titleTimer > 0 ? '♪ ' + music.currentSong().name : '') : '♪ OFF (B5)');
    }
    let banner = '';
    if (!this.isGameOver) {
      if (race.noticeTimer > 0) {
        banner = race.notice;
      } else if (race.bannerTimer > 0) {
        banner = race.banner;
      } else if (gap > ESCAPE_DISTANCE && race.started) {
        banner = '¡SE ESCAPA! ACERCATE';
      }
    }
    this.bannerText.setText(banner).setVisible(!!banner);

    // feedback on the last gallop press, over the speed meter; a press after a long pause is a fresh start, not "slow"
    const quality = race.tapQuality[race.tapQuality.length - 1];
    const showRhythm = !this.isGameOver && race.fallTimer <= 0 && quality && race.time - race.lastTapTime < 1 && race.tapIntervals[race.tapIntervals.length - 1] < 1.2;
    this.rhythmText
      .setText(quality >= 1 ? 'GALOPE: BUEN RITMO' : quality > 0.55 ? 'GALOPE: MUY LENTO' : 'GALOPE: ¡MUY RAPIDO!')
      .setColor(quality >= 1 ? '#ffd166' : quality > 0.55 ? '#ff8c3a' : '#ff4a5a')
      .setVisible(!!showRhythm);
    const hint = this.isGameOver ? '' : race.hint();
    this.hintText.setText(hint).setVisible(!!hint).setAlpha(0.75 + 0.25 * Math.sin(this.elapsed * 6));
  }
}

// ---------- boot ----------

function normalizeIncomingKey(key) {
  if (typeof key !== 'string' || key.length === 0) {
    return '';
  }

  if (key === ' ') {
    return 'space';
  }

  return key.toLowerCase();
}

async function boot() {
  // a slow or missing storage must not keep the game from starting
  await Promise.race([loadSavedValues(), new Promise((resolve) => setTimeout(resolve, 1500))]);
  const savedSong = savedValues[SONG_KEY];
  if (savedSong !== undefined && savedSong < SONGS.length) {
    music.songIndex = savedSong;
  }
  new Phaser.Game({
    type: Phaser.AUTO,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    parent: 'game-root',
    backgroundColor: '#000000',
    pixelArt: true,
    roundPixels: true,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
    },
    scene: [MenuScene, new ChaseScene('chase'), new ChaseScene('chase2')],
  });
}

boot();
