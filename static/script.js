document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURATION ---
    const API_BASE_URL = 'http://127.0.0.1:5000';
    const CUSTOM_PROFILES_KEY = 'aiStylizerCustomProfiles';
    const POLLING_INTERVAL_MS = 2000;
    const POLLING_TIMEOUT_MS = 300000;

    // --- DOM ELEMENT REFERENCES ---
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('file-input');
    const imagePreview = document.getElementById('image-preview');
    const loader = document.getElementById('loader');
    const loaderText = document.querySelector('#loader p');
    const errorToast = document.getElementById('error-toast');
    const cancelUploadBtn = document.getElementById('cancel-upload-btn');
    const applyBtn = document.getElementById('apply-btn');
    const downloadBtn = document.getElementById('download-btn');
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');
    const saveDefaultsBtn = document.getElementById('save-defaults-btn');
    const resetDefaultsBtn = document.getElementById('reset-defaults-btn');
    const advancedSettingsHeader = document.getElementById('advanced-settings-header');
    const advancedSettingsContent = document.getElementById('advanced-settings-content');
    const customProfileSelect = document.getElementById('custom-profile-select');
    const deleteProfileBtn = document.getElementById('delete-profile-btn');
    const saveProfileNameInput = document.getElementById('save-profile-name');
    const saveProfileBtn = document.getElementById('save-profile-btn');
    const promptInput = document.getElementById('prompt-input');
    const prompt2Input = document.getElementById('prompt-2-input');
    const prompt2Enabled = document.getElementById('prompt-2-enabled');
    const negativePromptInput = document.getElementById('negative-prompt-input');
    const negativePromptEnabled = document.getElementById('negative-prompt-enabled');
    const negativePrompt2Input = document.getElementById('negative-prompt-2-input');
    const negativePrompt2Enabled = document.getElementById('negative-prompt-2-enabled');
    const widthInput = document.getElementById('width-input');
    const heightInput = document.getElementById('height-input');
    const adjustResolutionCheckbox = document.getElementById('adjust-resolution-checkbox');
    const stepsSlider = document.getElementById('steps-slider');
    const stepsValue = document.getElementById('steps-value');
    const stepsNumber = document.getElementById('steps-number');
    const guidanceSlider = document.getElementById('guidance-slider');
    const guidanceValue = document.getElementById('guidance-value');
    const guidanceNumber = document.getElementById('guidance-number');
    const cfgSlider = document.getElementById('cfg-slider');
    const cfgValue = document.getElementById('cfg-value');
    const cfgNumber = document.getElementById('cfg-number');
    const useSpecificSeedCheckbox = document.getElementById('use-specific-seed-checkbox');
    const seedInput = document.getElementById('seed-input');
    const accordionContainer = document.getElementById('style-profiles-accordion');

    // --- STATE MANAGEMENT ---
    let originalFile = null;
    let history = [];
    let historyIndex = -1;
    let pollingIntervalId = null;
    let appData = {}; // Will hold data from profiles.json
    let profilesMap = new Map(); // For quick lookup of profiles by ID

    // --- CORE FUNCTIONS ---
    const getCurrentSettings = () => ({
        prompt: promptInput.value,
        prompt_2: prompt2Input.value,
        prompt_2_enabled: prompt2Enabled.checked,
        negative_prompt: negativePromptInput.value,
        negative_prompt_enabled: negativePromptEnabled.checked,
        negative_prompt_2: negativePrompt2Input.value,
        negative_prompt_2_enabled: negativePrompt2Enabled.checked,
        width: Number(widthInput.value),
        height: Number(heightInput.value),
        adjust_resolution: adjustResolutionCheckbox.checked,
        steps: Number(stepsSlider.value),
        guidance: Number(guidanceSlider.value),
        cfg: Number(cfgSlider.value),
        seed: seedInput.value,
        use_specific_seed: useSpecificSeedCheckbox.checked,
    });

    const updateControlsUI = (settings) => {
        promptInput.value = settings.prompt || '';
        const setupOptional = (baseKey, inputEl, checkboxEl) => {
            const enabledKey = `${baseKey}_enabled`;
            const value = settings[baseKey];
            inputEl.value = value || '';
            if (settings.hasOwnProperty(enabledKey)) {
                checkboxEl.checked = settings[enabledKey];
            } else {
                checkboxEl.checked = value !== null && value !== undefined && value !== '';
            }
            inputEl.disabled = !checkboxEl.checked;
        };
        setupOptional('prompt_2', prompt2Input, prompt2Enabled);
        setupOptional('negative_prompt', negativePromptInput, negativePromptEnabled);
        setupOptional('negative_prompt_2', negativePrompt2Input, negativePrompt2Enabled);
        seedInput.value = settings.seed || '';
        if (settings.hasOwnProperty('use_specific_seed')) {
            useSpecificSeedCheckbox.checked = settings.use_specific_seed;
        } else {
            useSpecificSeedCheckbox.checked = !!settings.seed;
        }
        seedInput.disabled = !useSpecificSeedCheckbox.checked;
        widthInput.value = settings.width || 1024;
        heightInput.value = settings.height || 1024;
        adjustResolutionCheckbox.checked = settings.adjust_resolution !== false;
        const isChecked = adjustResolutionCheckbox.checked;
        widthInput.disabled = isChecked;
        heightInput.disabled = isChecked;
        stepsSlider.value = stepsNumber.value = stepsValue.textContent = settings.steps || 40;
        guidanceSlider.value = guidanceNumber.value = guidanceValue.textContent = settings.guidance || 3.5;
        cfgSlider.value = cfgNumber.value = cfgValue.textContent = settings.cfg || 1.5;
    };

    const areSettingsEqual = (obj1, obj2) => JSON.stringify(obj1) === JSON.stringify(obj2);

    const maybeAdjustResolution = () => {
        if (adjustResolutionCheckbox.checked && imagePreview.src && imagePreview.naturalWidth > 0) {
            widthInput.value = imagePreview.naturalWidth;
            heightInput.value = imagePreview.naturalHeight;
        }
    };

    const loadSettings = (profileKey = 'default') => {
        let settings;
        let isUserDefaultLoad = false;
        let effectiveProfileKey = profileKey;

        if (profileKey === 'default') {
            const userDefaults = JSON.parse(localStorage.getItem('userDefaultSettings'));
            if (userDefaults) {
                settings = userDefaults;
                isUserDefaultLoad = true;
                showToast("Loaded your saved defaults.", true);
            } else {
                // Load the application's default settings from the JSON file
                settings = appData.app_defaults;
                // The default profile to highlight is 'ghibli_style_1'
                effectiveProfileKey = 'ghibli_style_1';
            }
        } else {
            settings = profilesMap.get(profileKey);
        }

        updateControlsUI(settings);
        maybeAdjustResolution();

        if (isUserDefaultLoad) {
            setActiveProfileButton(null);
        } else {
            setActiveProfileButton(effectiveProfileKey);
        }

        customProfileSelect.value = "";
        if (isUserDefaultLoad) {
            const customProfiles = JSON.parse(localStorage.getItem(CUSTOM_PROFILES_KEY) || '{}');
            const currentSettingsForCompare = getCurrentSettings();
            for (const name in customProfiles) {
                if (areSettingsEqual(currentSettingsForCompare, customProfiles[name])) {
                    customProfileSelect.value = name;
                    break;
                }
            }
        }
    };

    const saveDefaults = () => {
        if (!confirm("Are you sure you want to overwrite your saved default settings?")) return;
        const userDefaults = getCurrentSettings();
        localStorage.setItem('userDefaultSettings', JSON.stringify(userDefaults));
        showToast("Your settings have been saved as the new default.", true);
        showButtonFeedback(saveDefaultsBtn);
        const customProfiles = JSON.parse(localStorage.getItem(CUSTOM_PROFILES_KEY) || '{}');
        let matchingProfileName = null;
        for (const profileName in customProfiles) {
            if (areSettingsEqual(userDefaults, customProfiles[profileName])) {
                matchingProfileName = profileName;
                break;
            }
        }
        customProfileSelect.value = matchingProfileName || "";
    };

    const resetToAppDefaults = () => {
        if (!confirm("Are you sure you want to reset all settings to the application's original defaults?")) return;
        localStorage.removeItem('userDefaultSettings');
        updateControlsUI(appData.app_defaults);
        setActiveProfileButton('ghibli_style_1');
        customProfileSelect.value = "";
        showToast("Settings have been reset to app defaults.", true);
    };

    const populateCustomProfiles = () => {
        const profiles = JSON.parse(localStorage.getItem(CUSTOM_PROFILES_KEY) || '{}');
        customProfileSelect.innerHTML = '<option value="">-- Load a Profile --</option>';
        Object.keys(profiles).sort().forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            customProfileSelect.appendChild(option);
        });
    };

    const saveCustomProfile = () => {
        const name = saveProfileNameInput.value.trim();
        if (!name) {
            showToast("Please enter a name for the profile.");
            return;
        }
        const profiles = JSON.parse(localStorage.getItem(CUSTOM_PROFILES_KEY) || '{}');
        if (profiles[name] && !confirm(`A profile named "${name}" already exists. Overwrite it?`)) {
            return;
        }
        profiles[name] = getCurrentSettings();
        localStorage.setItem(CUSTOM_PROFILES_KEY, JSON.stringify(profiles));
        populateCustomProfiles();
        customProfileSelect.value = name;
        saveProfileNameInput.value = '';
        showToast(`Profile "${name}" saved.`, true);
        showButtonFeedback(saveProfileBtn, 'Saved!');
    };

    const loadCustomProfile = () => {
        const name = customProfileSelect.value;
        if (!name) return;
        const profiles = JSON.parse(localStorage.getItem(CUSTOM_PROFILES_KEY) || '{}');
        if (profiles[name]) {
            updateControlsUI(profiles[name]);
            maybeAdjustResolution();
            setActiveProfileButton(null);
            showToast(`Loaded profile "${name}".`, true);
        }
    };

    const deleteCustomProfile = () => {
        const name = customProfileSelect.value;
        if (!name) {
            showToast("Select a profile to delete.");
            return;
        }
        if (!confirm(`Are you sure you want to delete the profile "${name}"?`)) {
            return;
        }
        const profiles = JSON.parse(localStorage.getItem(CUSTOM_PROFILES_KEY) || '{}');
        delete profiles[name];
        localStorage.setItem(CUSTOM_PROFILES_KEY, JSON.stringify(profiles));
        populateCustomProfiles();
        showToast(`Profile "${name}" deleted.`, true);
    };

    const resetUploadUI = () => {
        originalFile = null;
        history = [];
        historyIndex = -1;
        imagePreview.src = '';
        imagePreview.style.display = 'none';
        uploadArea.classList.remove('disabled');
        cancelUploadBtn.style.display = 'none';
        applyBtn.disabled = true;
        downloadBtn.disabled = true;
        updateHistoryButtons();
    };

    const handleFileUpload = (file) => {
        if (!file || !file.type.startsWith('image/')) {
            showToast("Error: Please upload a valid image file (PNG, JPG, etc).");
            return;
        }
        originalFile = file;
        const reader = new FileReader();
        reader.onload = (e) => {
            const imageUrl = e.target.result;
            imagePreview.src = imageUrl;
            imagePreview.style.display = 'block';
            uploadArea.classList.add('disabled');
            cancelUploadBtn.style.display = 'inline-block';
            history = [imageUrl];
            historyIndex = 0;
            updateHistoryButtons();
            applyBtn.disabled = false;
            downloadBtn.disabled = false;
        };
        reader.readAsDataURL(file);
    };

    const applyEdits = async () => {
        if (!originalFile) {
            showToast("Please upload an image first.");
            return;
        }
        loader.style.display = 'flex';
        loaderText.innerHTML = "Submitting job to the server...";
        applyBtn.disabled = true;
        const formData = new FormData();
        formData.append('image', originalFile);
        const settings = getCurrentSettings();
        formData.append('prompt', settings.prompt);
        formData.append('width', settings.width);
        formData.append('height', settings.height);
        formData.append('num_inference_steps', settings.steps);
        formData.append('guidance_scale', settings.guidance);
        formData.append('true_cfg_scale', settings.cfg);
        if (settings.use_specific_seed && settings.seed) formData.append('seed', settings.seed);
        if (settings.prompt_2_enabled && settings.prompt_2) formData.append('prompt_2', settings.prompt_2);
        if (settings.negative_prompt_enabled && settings.negative_prompt) formData.append('negative_prompt', settings.negative_prompt);
        if (settings.negative_prompt_2_enabled && settings.negative_prompt_2) formData.append('negative_prompt_2', settings.negative_prompt_2);
        try {
            const generateResponse = await fetch(`${API_BASE_URL}/process-image`, {
                method: 'POST',
                body: formData
            });
            if (!generateResponse.ok) {
                const errorData = await generateResponse.json();
                throw new Error(errorData.error || `Server error: ${generateResponse.status}`);
            }
            const jobData = await generateResponse.json();
            const jobId = jobData.job_id;
            localStorage.setItem('activeJobId', jobId);
            pollForJobCompletion(jobId);
        } catch (error) {
            console.error('Submission Error:', error);
            showToast(`Error: ${error.message}`);
            loader.style.display = 'none';
            applyBtn.disabled = false;
        }
    };

    const pollForJobCompletion = (jobId) => {
        const startTime = Date.now();
        pollingIntervalId = setInterval(async () => {
            if (Date.now() - startTime > POLLING_TIMEOUT_MS) {
                clearInterval(pollingIntervalId);
                showToast("Error: The request timed out. The server might be too busy.");
                loader.style.display = 'none';
                applyBtn.disabled = false;
                return;
            }
            try {
                const statusResponse = await fetch(`${API_BASE_URL}/status/${jobId}`);
                if (!statusResponse.ok) {
                    throw new Error(`Failed to get job status (HTTP ${statusResponse.status})`);
                }
                const statusData = await statusResponse.json();
                if (statusData.status === 'completed') {
                    clearInterval(pollingIntervalId);
                    loaderText.innerHTML = "Done! Retrieving image...";
                    await fetchAndDisplayResult(jobId);
                } else if (statusData.status === 'failed') {
                    clearInterval(pollingIntervalId);
                    localStorage.removeItem('activeJobId');
                    throw new Error(statusData.error || "Job failed for an unknown reason.");
                } else {
                    let statusMessage = `Status: <b>${statusData.status}</b>`;
                    if (statusData.queue_position) {
                        statusMessage += ` (Position: ${statusData.queue_position})`;
                    }
                    loaderText.innerHTML = statusMessage;
                }
            } catch (error) {
                clearInterval(pollingIntervalId);
                console.error('Polling Error:', error);
                showToast(`Error: ${error.message}`);
                loader.style.display = 'none';
                applyBtn.disabled = false;
            }
        }, POLLING_INTERVAL_MS);
    };

    const fetchAndDisplayResult = async (jobId) => {
        try {
            const resultResponse = await fetch(`${API_BASE_URL}/result/${jobId}`);
            if (!resultResponse.ok) {
                throw new Error("Failed to fetch the final image.");
            }
            const imageBlob = await resultResponse.blob();
            const imageUrl = URL.createObjectURL(imageBlob);
            history = history.slice(0, historyIndex + 1);
            history.push(imageUrl);
            historyIndex++;
            imagePreview.src = imageUrl;
            updateHistoryButtons();
            originalFile = new File([imageBlob], `stylized-${Date.now()}.png`, {
                type: 'image/png'
            });
        } catch (error) {
            console.error('Result Fetch Error:', error);
            showToast(`Error: ${error.message}`);
        } finally {
            loader.style.display = 'none';
            applyBtn.disabled = false;
            localStorage.removeItem('activeJobId');
        }
    };

    const updateSourceImageFromHistory = async () => {
        if (historyIndex < 0 || historyIndex >= history.length) {
            console.error("History index out of bounds during source update.");
            return;
        }
        const currentImageUrl = history[historyIndex];
        applyBtn.disabled = true;
        try {
            const response = await fetch(currentImageUrl);
            const imageBlob = await response.blob();
            const fileType = imageBlob.type || 'image/png';
            const fileName = `history-image-${Date.now()}.png`;
            originalFile = new File([imageBlob], fileName, {
                type: fileType
            });
            applyBtn.disabled = false;
        } catch (error) {
            console.error("Error updating source image from history:", error);
            showToast("Error: Could not set the current image as the source for the next edit.");
        }
    };

    const downloadImage = () => {
        if (!imagePreview.src || imagePreview.src.startsWith('data:')) {
            showToast("There is no generated image to download yet.");
            return;
        }
        const a = document.createElement('a');
        a.href = imagePreview.src;
        a.download = `stylized-image-${Date.now()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    };

    const showToast = (message, isSuccess = false) => {
        errorToast.textContent = message;
        errorToast.style.background = isSuccess ? '#28a745' : 'var(--tertiary-color)';
        errorToast.style.display = 'block';
        setTimeout(() => {
            errorToast.style.display = 'none';
        }, 4000);
    };

    const showButtonFeedback = (button, message = "Saved!", duration = 2000) => {
        const originalText = button.innerHTML;
        button.innerHTML = message;
        button.disabled = true;
        setTimeout(() => {
            button.innerHTML = originalText;
            button.disabled = false;
        }, duration);
    };

    const updateHistoryButtons = () => {
        undoBtn.disabled = historyIndex <= 0;
        redoBtn.disabled = historyIndex >= history.length - 1;
    };

    const undo = async () => {
        if (historyIndex > 0) {
            historyIndex--;
            imagePreview.src = history[historyIndex];
            updateHistoryButtons();
            await updateSourceImageFromHistory();
        }
    };

    const redo = async () => {
        if (historyIndex < history.length - 1) {
            historyIndex++;
            imagePreview.src = history[historyIndex];
            updateHistoryButtons();
            await updateSourceImageFromHistory();
        }
    };

    const setActiveProfileButton = (activeProfile) => {
        document.querySelectorAll('.profile-btn').forEach(btn => btn.classList.toggle('active', btn.dataset.profile === activeProfile));
    };

    const setupOptionalField = (checkbox, input) => {
        checkbox.addEventListener('change', () => {
            input.disabled = !checkbox.checked;
        });
    };

    const checkForExistingJob = () => {
        const existingJobId = localStorage.getItem('activeJobId');
        if (existingJobId) {
            showToast("Checking status of a previous job...", true);
            loader.style.display = 'flex';
            applyBtn.disabled = true;
            originalFile = new File([""], "placeholder.txt");
            pollForJobCompletion(existingJobId);
        }
    };

    const buildStyleProfilesAccordion = (categories) => {
        accordionContainer.innerHTML = ''; // Clear existing
        categories.forEach((category, index) => {
            const isActive = index === 0;
            const categoryDiv = document.createElement('div');
            categoryDiv.className = `profile-category ${isActive ? 'active' : ''}`;

            const header = document.createElement('h3');
            header.className = 'profile-category-header';
            header.setAttribute('role', 'button');
            header.setAttribute('aria-expanded', String(isActive));
            header.tabIndex = 0;
            header.innerHTML = `
                <span>${category.name}</span>
                <span class="header-arrow" aria-hidden="true">▼</span>
            `;

            const contentDiv = document.createElement('div');
            contentDiv.className = 'profile-buttons profile-category-content';

            category.profiles.forEach(profile => {
                const button = document.createElement('button');
                button.className = 'profile-btn';
                button.dataset.profile = profile.id;
                button.textContent = profile.name; // Load name from JSON
                contentDiv.appendChild(button);
            });

            categoryDiv.appendChild(header);
            categoryDiv.appendChild(contentDiv);
            accordionContainer.appendChild(categoryDiv);
        });
    };

    async function initializeApp() {
        try {
            const response = await fetch('/static/profiles.json');
            if (!response.ok) throw new Error(`Failed to load profiles.json: ${response.statusText}`);
            appData = await response.json();

            // Create a map for easy profile lookup by ID
            appData.categories.forEach(category => {
                category.profiles.forEach(profile => {
                    profilesMap.set(profile.id, profile.settings);
                });
            });

            // Build the UI from the loaded data
            buildStyleProfilesAccordion(appData.categories);

            // --- EVENT LISTENERS (ATTACH AFTER DYNAMIC CONTENT IS CREATED) ---
            imagePreview.addEventListener('load', maybeAdjustResolution);
            uploadArea.addEventListener('click', () => !uploadArea.classList.contains('disabled') && fileInput.click());
            fileInput.addEventListener('change', (e) => handleFileUpload(e.target.files[0]));
            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                !uploadArea.classList.contains('disabled') && uploadArea.classList.add('drag-over');
            });
            uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadArea.classList.remove('drag-over');
                !uploadArea.classList.contains('disabled') && handleFileUpload(e.dataTransfer.files[0]);
            });
            cancelUploadBtn.addEventListener('click', resetUploadUI);
            applyBtn.addEventListener('click', applyEdits);
            downloadBtn.addEventListener('click', downloadImage);
            undoBtn.addEventListener('click', undo);
            redoBtn.addEventListener('click', redo);
            saveDefaultsBtn.addEventListener('click', saveDefaults);
            resetDefaultsBtn.addEventListener('click', resetToAppDefaults);
            saveProfileBtn.addEventListener('click', saveCustomProfile);
            customProfileSelect.addEventListener('change', loadCustomProfile);
            deleteProfileBtn.addEventListener('click', deleteCustomProfile);

            // Event delegation for dynamically created profile buttons
            accordionContainer.addEventListener('click', (e) => {
                const button = e.target.closest('.profile-btn');
                if (button) {
                    loadSettings(button.dataset.profile);
                }
            });

            advancedSettingsHeader.addEventListener('click', () => {
                const isExpanded = advancedSettingsHeader.getAttribute('aria-expanded') === 'true';
                advancedSettingsHeader.setAttribute('aria-expanded', String(!isExpanded));
                advancedSettingsContent.style.display = isExpanded ? 'none' : 'block';
            });
            const syncSliderAndNumber = (slider, number, valueLabel) => {
                slider.addEventListener('input', () => { number.value = slider.value; if (valueLabel) valueLabel.textContent = slider.value; });
                number.addEventListener('input', () => { slider.value = number.value; if (valueLabel) valueLabel.textContent = number.value; });
            };
            syncSliderAndNumber(stepsSlider, stepsNumber, stepsValue);
            syncSliderAndNumber(guidanceSlider, guidanceNumber, guidanceValue);
            syncSliderAndNumber(cfgSlider, cfgNumber, cfgValue);
            adjustResolutionCheckbox.addEventListener('change', () => {
                const isChecked = adjustResolutionCheckbox.checked;
                if (isChecked) maybeAdjustResolution();
                widthInput.disabled = isChecked;
                heightInput.disabled = isChecked;
            });
            setupOptionalField(prompt2Enabled, prompt2Input);
            setupOptionalField(negativePromptEnabled, negativePromptInput);
            setupOptionalField(negativePrompt2Enabled, negativePrompt2Input);
            useSpecificSeedCheckbox.addEventListener('change', () => { seedInput.disabled = !useSpecificSeedCheckbox.checked; });

            // Accordion Logic
            accordionContainer.addEventListener('click', (e) => {
                const header = e.target.closest('.profile-category-header');
                if (!header) return;
                const parentCategory = header.parentElement;
                const isAlreadyActive = parentCategory.classList.contains('active');
                accordionContainer.querySelectorAll('.profile-category').forEach(cat => {
                    cat.classList.remove('active');
                    cat.querySelector('.profile-category-header').setAttribute('aria-expanded', 'false');
                });
                if (!isAlreadyActive) {
                    parentCategory.classList.add('active');
                    header.setAttribute('aria-expanded', 'true');
                }
            });
            accordionContainer.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    const header = e.target.closest('.profile-category-header');
                    if (header) {
                        e.preventDefault();
                        header.click();
                    }
                }
            });

            // Final Initialization
            loadSettings('default');
            populateCustomProfiles();
            checkForExistingJob();

        } catch (error) {
            console.error("Initialization failed:", error);
            showToast("Error: Could not load application configuration.");
        }
    }

    initializeApp();
});
