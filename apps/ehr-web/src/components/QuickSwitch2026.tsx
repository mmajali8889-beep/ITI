import {
  useEffect,
  useRef,
} from 'react';

export interface QuickSwitchOption {
  value: string;
  label: string;
  description?: string;
  accent?: string;
}

interface QuickSwitch2026Props {
  value: string;
  options: QuickSwitchOption[];
  onChange: (value: string) => void;
  label?: string;
}

export default function QuickSwitch2026({
  value,
  options,
  onChange,
  label = 'Quick switch',
}: QuickSwitch2026Props) {
  const hostRef =
    useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;

    if (!host) {
      return;
    }

    host.replaceChildren();

    const wrapper =
      document.createElement('label');

    wrapper.className =
      'quick-switch-2026';

    const caption =
      document.createElement('span');

    caption.className =
      'quick-switch-2026-caption';

    caption.textContent = label;

    const select =
      document.createElement('select');

    select.className =
      'select-2026 quick-switch-2026-select';

    select.setAttribute(
      'aria-label',
      label,
    );

    const supportsCustomSelect =
      typeof CSS !== 'undefined' &&
      typeof CSS.supports === 'function' &&
      CSS.supports(
        'appearance',
        'base-select',
      );

    if (supportsCustomSelect) {
      const button =
        document.createElement('button');

      button.type = 'button';
      button.className =
        'select-2026-button';

      const selectedContent =
        document.createElement(
          'selectedcontent',
        );

      selectedContent.className =
        'select-2026-selectedcontent';

      button.append(selectedContent);
      select.append(button);
    }

    options.forEach((item) => {
      const option =
        document.createElement('option');

      option.value = item.value;
      option.textContent = item.label;

      if (item.description) {
        option.title =
          item.description;
      }

      if (item.accent) {
        option.dataset.accent =
          item.accent;
      }

      select.append(option);
    });

    select.value = value;

    const handleChange = () => {
      onChange(select.value);
    };

    select.addEventListener(
      'change',
      handleChange,
    );

    wrapper.append(
      caption,
      select,
    );

    host.append(wrapper);

    return () => {
      select.removeEventListener(
        'change',
        handleChange,
      );

      host.replaceChildren();
    };
  }, [
    label,
    onChange,
    options,
    value,
  ]);

  return (
    <div
      ref={hostRef}
      className="quick-switch-2026-host"
    />
  );
}
