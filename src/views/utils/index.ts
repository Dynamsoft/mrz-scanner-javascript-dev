import { ToolbarButton } from "./types";

export function getElement(element: string | HTMLElement): HTMLElement | null {
  if (typeof element === "string") {
    const el = document.querySelector(element) as HTMLElement;
    if (!el) throw new Error("Element not found");
    return el;
  }
  return element instanceof HTMLElement ? element : null;
}

const DEFAULT_CONTROLS_STYLE = `
  .dynamsoft-mrz-controls {
    display: flex;
    height: 8rem;
    background-color: #323234;
    align-items: center;
    font-size: 12px;
    font-family: Verdana;
    color: white;
    width: 100%;
  }

  .dynamsoft-mrz-control-btn {
    background-color: #323234;
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    height: 100%;
    width: 100%;
    gap: 0.5rem;
    text-align: center;
    user-select: none;
  }

  .dynamsoft-mrz-control-btn.hide {
    display: none;
  }

  .dynamsoft-mrz-control-btn.disabled {
    opacity: 0.4;
    pointer-events: none;
    cursor: default;
  }

  .dynamsoft-mrz-control-icon-wrapper {
    flex: 0.75;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    min-height: 40px;
  }

  .dynamsoft-mrz-control-icon img,
  .dynamsoft-mrz-control-icon svg {
    width: 32px;
    height: 32px;
    fill: #fe8e14;
  }

  .dynamsoft-mrz-control-text {
    flex: 0.5;
    display: flex;
    align-items: flex-start;
    justify-content: center;
  }
`;

export function createControls(buttons: ToolbarButton[], containerStyle?: Partial<CSSStyleDeclaration>): HTMLElement {
  createStyle("dynamsoft-mrz-controls-style", DEFAULT_CONTROLS_STYLE);

  // Create container
  const container = document.createElement("div");
  container.className = "dynamsoft-mrz-controls";

  // Apply custom container styles if provided
  if (containerStyle) {
    Object.assign(container.style, containerStyle);
  }

  // Create buttons
  buttons.forEach((button) => {
    const buttonEl = document.createElement("div");
    buttonEl.className = `dynamsoft-mrz-control-btn ${button?.className}`;

    // Create icon container
    const iconContainer = document.createElement("div");
    iconContainer.className = "dynamsoft-mrz-control-icon-wrapper";

    if (isSVGString(button.icon)) {
      iconContainer.innerHTML = button.icon;
    } else {
      const iconImg = document.createElement("img");
      iconImg.src = button.icon;
      iconImg.alt = button.label;
      iconImg.width = 24;
      iconImg.height = 24;
      iconContainer.appendChild(iconImg);
    }

    // Create text container
    const textContainer = document.createElement("div");
    textContainer.className = "dynamsoft-mrz-control-text";
    textContainer.textContent = button.label;

    // Add disabled state if specified
    if (button.isDisabled) {
      buttonEl.classList.add("disabled");
    }

    if (button.isHidden) {
      buttonEl.classList.add("hide");
    }

    // Append containers to button
    buttonEl.appendChild(iconContainer);
    buttonEl.appendChild(textContainer);

    if (button.onClick && !button.isDisabled) {
      buttonEl.addEventListener("click", button.onClick);
    }

    container.appendChild(buttonEl);
  });

  return container;
}

export function createStyle(id: string, style: string) {
  // Initialize styles if not already done
  if (!document.getElementById(id)) {
    const styleSheet = document.createElement("style");
    styleSheet.id = id;
    styleSheet.textContent = style;
    document.head.appendChild(styleSheet);
  }
}

export function isSVGString(str: string): boolean {
  return str.trim().startsWith("<svg") && str.trim().endsWith("</svg>");
}

export const isEmptyObject = (obj: object | null | undefined): boolean => {
  return !obj || Object.keys(obj).length === 0;
};
