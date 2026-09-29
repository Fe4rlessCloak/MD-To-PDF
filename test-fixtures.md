# Mermaid Edge-Case Validation Fixtures

This document exercises print-safe Mermaid scaling behavior across several difficult rendering cases.

## 1. Extremely Wide Flowchart

This chart is intentionally wide to verify horizontal downscaling without destroying legibility or overflowing the content box.

```mermaid
flowchart LR
    A[Start] --> B[Collect Requirements]
    B --> C[Validate Inputs]
    C --> D[Normalize Markdown]
    D --> E[Transform Mermaid Fences]
    E --> F[Inject Custom CSS]
    F --> G[Bootstrap Mermaid Runtime]
    G --> H[Render HTML in Chromium]
    H --> I[Wait for Diagram Completion]
    I --> J[Compute Print Layout]
    J --> K[Scale SVG to Page Constraints]
    K --> L[Export PDF]
    L --> M[Archive Output]
    M --> N[Send Notification]
```

## 2. Very Tall Sequence Diagram

This sequence diagram is intentionally tall and dense to verify the 45vh cap, proportional downscaling, and absence of overlap with surrounding content.

```mermaid
sequenceDiagram
    autonumber
    participant User
    participant CLI
    participant Loader
    participant Parser
    participant Builder
    participant Browser
    participant Mermaid
    participant PDF

    User->>CLI: Start conversion
    CLI->>Loader: Read Markdown
    Loader-->>CLI: Markdown content
    CLI->>Loader: Read optional stylesheet
    Loader-->>CLI: Stylesheet content
    CLI->>Parser: Parse Markdown
    Parser-->>CLI: HTML body
    CLI->>Builder: Build HTML shell
    Builder-->>CLI: Complete HTML document
    CLI->>Browser: Load HTML into page
    Browser->>Mermaid: Initialize runtime
    Mermaid-->>Browser: Ready
    Browser->>Mermaid: Render first diagram
    Mermaid-->>Browser: First SVG complete
    Browser->>Mermaid: Render second diagram
    Mermaid-->>Browser: Second SVG complete
    Browser->>Mermaid: Render third diagram
    Mermaid-->>Browser: Third SVG complete
    Browser->>Mermaid: Render fourth diagram
    Mermaid-->>Browser: Fourth SVG complete
    Browser->>Browser: Measure SVG bounding boxes
    Browser->>Browser: Apply print-safe scaling
    Browser->>PDF: Export generated document
    PDF-->>CLI: PDF buffer
    CLI-->>User: Conversion completed
```

Paragraph after tall diagram: this text should remain clearly below the diagram with no vertical overlap, clipping, or accidental intrusion into the diagram area.

## 3. Small Simple Diagram

This tiny diagram verifies that a small Mermaid block does not get artificially upscaled into an oversized graphic.

```mermaid
flowchart TD
    A[One] --> B[Two]
```

## 4. Diagram with Long Node Text

This chart verifies label handling, wrapping, and clipping behavior for long text inside node shapes.

```mermaid
flowchart TD
    A[This is a deliberately long node label intended to validate whether text remains visually contained inside the shape during print-oriented downscaling] --> B[Another long descriptive node label that should remain readable and should not spill outside its bounding rectangle when converted to PDF]
    B --> C{Does the print renderer preserve alignment, wrapping, and proportional scaling for long textual content inside Mermaid nodes?}
    C -->|Yes| D[The layout strategy is behaving as expected under PDF generation constraints]
    C -->|No| E[Further SVG sizing or Mermaid configuration adjustments are still required]
```

## 5. Mixed Layout Regression Check

Regular content before and after a diagram should remain stable.

### Intro Paragraph

The following chart appears between two ordinary text sections. It should be centered, constrained, and integrated into normal flow without breaking nearby headings or paragraphs.

```mermaid
flowchart TD
    Input[Markdown + CSS] --> Render[HTML Rendering]
    Render --> Diagram[Mermaid SVG]
    Diagram --> Output[PDF Output]
```

### Closing Paragraph

If this paragraph appears immediately after the diagram without overlap or clipping, the integration with the print layout flow is behaving correctly.
