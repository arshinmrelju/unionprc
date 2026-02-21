/**
 * Custom Select Component
 * Replaces native <select> with a custom, styleable dropdown
 * while maintaining the native select as the source of truth.
 */

class CustomSelect {
    constructor(nativeSelect) {
        this.nativeSelect = nativeSelect;
        this.container = null;
        this.trigger = null;
        this.optionsList = null;
        this.isOpen = false;

        this.init();
    }

    init() {
        // Create custom structure
        this.createStructure();

        // Hide native select
        this.nativeSelect.style.display = 'none';

        // Initial render
        this.renderOptions();
        this.updateTriggerText();

        // Event Listeners
        this.attachEvents();

        // Watch for changes in native select (options added/removed dynamically)
        this.observer = new MutationObserver(() => {
            this.renderOptions();
            this.updateTriggerText();
        });

        this.observer.observe(this.nativeSelect, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['selected', 'disabled']
        });
    }

    createStructure() {
        // Container
        this.container = document.createElement('div');
        this.container.classList.add('custom-select-container');

        // Trigger (The box you click)
        this.trigger = document.createElement('div');
        this.trigger.classList.add('custom-select-trigger');
        this.trigger.innerHTML = `
            <span class="custom-select-text"></span>
            <i class="fas fa-chevron-down custom-select-arrow"></i>
        `;

        // Options List (The dropdown menu)
        this.optionsList = document.createElement('div');
        this.optionsList.classList.add('custom-options');

        // Insert after native select
        this.nativeSelect.parentNode.insertBefore(this.container, this.nativeSelect.nextSibling);
        this.container.appendChild(this.trigger);
        this.container.appendChild(this.optionsList);
    }

    renderOptions() {
        this.optionsList.innerHTML = '';
        const options = Array.from(this.nativeSelect.options);

        if (options.length === 0) {
            this.trigger.classList.add('disabled');
            return;
        }

        // Check if native select is disabled
        if (this.nativeSelect.disabled) {
            this.container.classList.add('disabled');
        } else {
            this.container.classList.remove('disabled');
        }

        options.forEach(option => {
            if (option.disabled && option.value === "") return; // Skip placeholder if needed, or style it differently

            const customOption = document.createElement('div');
            customOption.classList.add('custom-option');
            customOption.textContent = option.textContent;
            customOption.dataset.value = option.value;

            if (option.selected) {
                customOption.classList.add('selected');
            }

            if (option.disabled) {
                customOption.classList.add('disabled');
            }

            customOption.addEventListener('click', (e) => {
                e.stopPropagation();
                if (option.disabled) return;

                this.selectOption(option.value);
                this.close();
            });

            this.optionsList.appendChild(customOption);
        });
    }

    updateTriggerText() {
        const selectedOption = this.nativeSelect.options[this.nativeSelect.selectedIndex];
        const textSpan = this.trigger.querySelector('.custom-select-text');

        if (selectedOption) {
            textSpan.textContent = selectedOption.textContent;
            if (selectedOption.value === "") {
                textSpan.classList.add('placeholder');
            } else {
                textSpan.classList.remove('placeholder');
            }
        }
    }

    selectOption(value) {
        this.nativeSelect.value = value;
        // Dispatch change event so other scripts know it changed
        this.nativeSelect.dispatchEvent(new Event('change'));
        this.updateTriggerText();

        // Update visual selection
        const options = this.optionsList.querySelectorAll('.custom-option');
        options.forEach(opt => {
            if (opt.dataset.value === value) {
                opt.classList.add('selected');
            } else {
                opt.classList.remove('selected');
            }
        });

        // Trigger float label effect if present in CSS
        this.container.classList.add('has-value');
    }

    open() {
        if (this.container.classList.contains('disabled')) return;

        // Close all other selects first
        document.querySelectorAll('.custom-select-container').forEach(el => el.classList.remove('open'));

        this.container.classList.add('open');
        this.isOpen = true;
    }

    close() {
        this.container.classList.remove('open');
        this.isOpen = false;
    }

    toggle() {
        if (this.isOpen) this.close();
        else this.open();
    }

    attachEvents() {
        this.trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggle();
        });

        // Close when clicking outside
        document.addEventListener('click', (e) => {
            if (!this.container.contains(e.target)) {
                this.close();
            }
        });

        // Listen for external changes to the native select (e.g. from JS)
        this.nativeSelect.addEventListener('change', () => {
            this.updateTriggerText();
            this.renderOptions(); // Re-render to update 'selected' class
        });
    }
}

export function initCustomSelects() {
    const selects = document.querySelectorAll('select');
    selects.forEach(select => {
        // Avoid double initialization
        if (select.nextSibling && select.nextSibling.classList && select.nextSibling.classList.contains('custom-select-container')) {
            return;
        }
        new CustomSelect(select);
    });
}
