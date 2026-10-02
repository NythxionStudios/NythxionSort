```text
███╗   ██╗██╗   ██╗████████╗██╗  ██╗██╗  ██╗██╗ ██████╗ ███╗   ██╗
████╗  ██║╚██╗ ██╔╝╚══██╔══╝██║  ██║╚██╗██╔╝██║██╔═══██╗████╗  ██║
██╔██╗ ██║ ╚████╔╝    ██║   ███████║ ╚███╔╝ ██║██║   ██║██╔██╗ ██║
██║╚██╗██║  ╚██╔╝     ██║   ██╔══██║ ██╔██╗ ██║██║   ██║██║╚██╗██║
██║ ╚████║   ██║      ██║   ██║  ██║██╔╝ ██╗██║╚██████╔╝██║ ╚████║
╚═╝  ╚═══╝   ╚═╝      ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═════╝  ╚═╝  ╚═══╝

                    O P E N - S O U R C E
```

# Nythxion Merge Sort

A small, dependency-free browser game that turns sorting algorithms into hands-on puzzles.

**Merge Sort Game** challenges you to merge sorted runs by choosing the smallest available front value. **Quick Sort Game** has you follow the pivot through each partition by selecting the highlighted value to compare.

## Getting Started

You can either **build on the project and develop it yourself** by cloning the repository, or simply **visit the live website** through the GitHub repository's **About** section.

## Modes

### Game Mode

Choose between **Merge Sort** and **Quick Sort**, with support for **8–64 bars**.

* **Merge Sort:** Select the smaller value at the front of either sorted run.
* **Quick Sort:** Compare the highlighted scan value against the current pivot.
* Correct actions earn score and build combos.
* Optional synthesized sound effects can be enabled or muted.

### Visualizer Mode

Visualize how the algorithms actually work with **8–256 bars**.

Choose between:

* **Merge Sort**
* **Quick Sort**
* **Compare** — runs both algorithms on the same input array.

The Visualizer includes:

* Adjustable step timing
* Pause / resume
* Single-step playback
* Algorithm explanations
* Optional procedural sound effects
* **Restart** to replay the same array
* **Shuffle / New Array** to generate a fresh array

## How to Play

Open `index.html` in a modern browser.

In **Game Mode**, select an algorithm and bar count, then start the game. Follow the rules of the selected algorithm to make the correct choices.

In **Visualizer Mode**, select an algorithm and watch its sorting process step by step. In **Compare** mode, both algorithms run on the same starting array so their behavior can be compared directly.

## Implementation

* `createMergePlan` recursively divides the input and records post-order merge steps, keeping sorting logic separate from rendering and interaction.
* Quick Sort uses in-place pivot partitioning for Game Mode and cached compare, swap, and pivot frames for Visualizer Mode.
* The Visualizer explains the selected algorithm and runs Compare lanes from the same input array.
* Visualizer animations use cached split, merge, and partition states, so the displayed steps reflect the actual algorithms rather than a separate sorting shortcut.
* Visualizer layouts are precomputed into compact position and group caches when an array is created. Playback reuses persistent bar elements and interpolates only their cached positions.
* Merge Sort Game only accepts the current head of either sorted run as a correct move, preserving the Merge Sort merge invariant.
* Built with plain **HTML, CSS, and vanilla JavaScript**.
* No build step, package installation, backend, or external runtime dependency is required.

## License

This project is released under the **MIT License**. See [`LICENSE`](LICENSE).

### Code, Software & Assets

The MIT License applies to the **software and included project assets**, including:

* Source code
* HTML, CSS, and JavaScript
* Images and graphics
* Icons
* Sound effects and audio
* Other included project assets

You are free to **copy, modify, build upon, reuse, and redistribute** these parts of the project under the terms of the MIT License.

### Branding

The **Nythxion branding is not included under the MIT License**.

This includes the **Nythxion name, logos, trademarks, and other elements identifying the project as an official Nythxion project**.

If you reuse or fork this project, you may use and modify the code and included assets, but you must **remove or replace Nythxion branding** from your version. You must also not present your version as an official Nythxion project or imply endorsement or affiliation.

**In short: copy it, modify it, build on it, and make it your own, keep the required attribution, and remove the Nythxion identity.**
