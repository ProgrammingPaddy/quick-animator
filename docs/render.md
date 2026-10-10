# Rendering from the terminal

Renders a project to a video file without opening the window, through the same renderer the
preview uses, so the file matches what the app shows frame for frame.

```
quick-animator render <project> [--out file] [--preset h264|h265|webm|prores|png] [--from seconds] [--to seconds]
```

While the app runs from source, the same command is:

```
npm run render -- <project> [options]
```

`<project>` is the folder that holds `project.json`. The width, height, and frame rate come from
that file, and so does the length: from zero to the end of the last action plus the project's
`hold`.

| Option | Meaning | Default |
|--------|---------|---------|
| `--out file` | Where to write. For `png`, a folder that gets `frame_00000.png`, `frame_00001.png`, … | next to the project: `<name>.mp4`, `<name>.mov`, `<name>.webm`, or `<name>-frames/` |
| `--preset` | `h264` mp4 (plays everywhere), `h265` mp4 (smaller), `webm` VP9, `prores` ProRes 4444 mov with alpha, `png` sequence with alpha | `h264` |
| `--from`, `--to` | Seconds; render only this part | the whole content |

Progress goes to stdout as `frame/total (percent)`, then `wrote <path>`. Errors go to stderr: a
project that does not load, a scene with an error, or an encoder failure, and the exit code is 1.
A scene with no actions renders one frame.

Presets with alpha render on nothing; the others render on the project's `background` color
from `project.json`, the color the preview shows inside the frame.

Examples:

```
quick-animator render C:\work\intro
quick-animator render C:\work\intro --preset prores --out C:\work\intro\for-edit.mov
quick-animator render C:\work\intro --from 2 --to 4.5 --preset png --out C:\work\intro\stills
```

`node scripts/check-export.mjs` checks the pipeline: two headless PNG renders must be
byte-identical, and an H.264 render must hold the same frames and match them closely.
