document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURATION ---
    const CUSTOM_PROFILES_KEY = 'aiStylizerCustomProfiles';
    const JOB_QUEUE_KEY = 'aiStylizerJobQueue'; // Key for storing job IDs
    const POLLING_INTERVAL_MS = 3000; // Check status every 3 seconds

    // --- DOM ELEMENT REFERENCES ---
    const uploadArea = document.getElementById('upload-area');
    const fileInput = document.getElementById('file-input');
    const imagePreview = document.getElementById('image-preview');
    const loader = document.getElementById('loader');
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
    // Job Queue elements
    const jobListContainer = document.getElementById('job-list');
    const jobTemplate = document.getElementById('job-template');


    // --- STATE MANAGEMENT ---
    let API_BASE_URL;
    let originalFile = null;
    let history = [];
    let historyIndex = -1;
    let masterPollingIntervalId = null;
    let appData = {};
    let profilesMap = new Map();
    let activeJobs = new Map(); // Use a Map to hold job data { jobId -> { element, status } }

    // --- JOB QUEUE FUNCTIONS ---

    /**
     * Loads jobs from localStorage and populates the UI queue.
     */
    const loadJobsFromStorage = () => {
        const storedJobs = JSON.parse(localStorage.getItem(JOB_QUEUE_KEY) || '[]');
        storedJobs.forEach(jobId => {
            if (!activeJobs.has(jobId)) {
                addJobToQueueUI(jobId);
                activeJobs.set(jobId, { status: 'UNKNOWN' });
            }
        });
        if (activeJobs.size > 0) {
            startMasterPolling();
        }
    };

    /**
     * Saves the current list of active job IDs to localStorage.
     */
    const saveJobsToStorage = () => {
        // Only save jobs that are not in a final state
        const jobsToSave = Array.from(activeJobs.keys()).filter(jobId => {
            const job = activeJobs.get(jobId);
            return job.status !== 'SUCCESS' && job.status !== 'FAILURE';
        });
        localStorage.setItem(JOB_QUEUE_KEY, JSON.stringify(jobsToSave));
    };

    /**
     * Creates and adds a new job item to the visual queue.
     * @param {string} jobId - The ID of the new job.
     * @param {string} [sourceImageUrl] - The data URL of the source image for the preview.
     */
    const addJobToQueueUI = (jobId, sourceImageUrl) => {
        const templateContent = jobTemplate.content.cloneNode(true);
        const jobItem = templateContent.querySelector('.job-item');
        jobItem.dataset.jobId = jobId;

        const previewImg = jobItem.querySelector('.job-preview img');
        if (sourceImageUrl) {
            previewImg.src = sourceImageUrl;
        }

        jobItem.querySelector('.job-id span').textContent = jobId.substring(0, 8) + '...';
        jobItem.querySelector('.job-status span').textContent = 'QUEUED';
        
        // Add to the top of the list
        jobListContainer.prepend(jobItem);

        activeJobs.set(jobId, { element: jobItem, status: 'QUEUED' });
        saveJobsToStorage();
    };

    /**
     * Updates the UI for a specific job based on new status data.
     * @param {string} jobId - The ID of the job to update.
     * @param {object} statusData - The status data from the API.
     */
    const updateJobUI = async (jobId, statusData) => {
        const job = activeJobs.get(jobId);
        if (!job || !job.element) return;

        const statusSpan = job.element.querySelector('.job-status span');
        const jobSpinner = job.element.querySelector('.job-spinner');
        const previewImg = job.element.querySelector('.job-preview img');

        job.status = statusData.status.toUpperCase();
        statusSpan.textContent = job.status;

        switch (job.status) {
            case 'PENDING':
            case 'STARTED':
                jobSpinner.style.display = 'block';
                break;
            case 'SUCCESS':
                jobSpinner.style.display = 'none';
                // Fetch the final image and display it as a thumbnail
                try {
                    const resultResponse = await fetch(`${API_BASE_URL}/result/${jobId}`);
                    if (resultResponse.ok) {
                        const imageBlob = await resultResponse.blob();
                        previewImg.src = URL.createObjectURL(imageBlob);
                        // Make the completed job clickable to load into main view
                        job.element.classList.add('clickable');
                        job.element.addEventListener('click', () => {
                           imagePreview.src = previewImg.src;
                           downloadBtn.disabled = false;
                        });
                    }
                } catch (e) {
                    console.error("Failed to load result image for job", jobId, e);
                    statusSpan.textContent = 'IMG FAILED';
                }
                saveJobsToStorage(); // Remove from active polling
                break;
            case 'FAILURE':
                jobSpinner.style.display = 'none';
                job.element.classList.add('failed');
                statusSpan.textContent = `FAILED: ${statusData.error || 'Unknown'}`;
                saveJobsToStorage(); // Remove from active polling
                break;
        }
    };

    /**
     * Starts a single interval to poll all active jobs.
     */
    const startMasterPolling = () => {
        if (masterPollingIntervalId) {
            clearInterval(masterPollingIntervalId);
        }

        masterPollingIntervalId = setInterval(async () => {
            const jobsToPoll = Array.from(activeJobs.keys()).filter(jobId => {
                const job = activeJobs.get(jobId);
                return job.status !== 'SUCCESS' && job.status !== 'FAILURE';
            });

            if (jobsToPoll.length === 0) {
                clearInterval(masterPollingIntervalId);
                masterPollingIntervalId = null;
                return;
            }

            for (const jobId of jobsToPoll) {
                try {
                    const statusResponse = await fetch(`${API_BASE_URL}/status/${jobId}`);
                    if (statusResponse.ok) {
                        const statusData = await statusResponse.json();
                        updateJobUI(jobId, statusData);
                    }
                } catch (error) {
                    console.error(`Polling error for job ${jobId}:`, error);
                }
            }
        }, POLLING_INTERVAL_MS);
    };


    // --- CORE FUNCTIONS (MODIFIED) ---

    const applyEdits = async () => {
        if (!originalFile) {
            showToast("Please upload an image first.");
            return;
        }
        loader.style.display = 'flex';
        applyBtn.disabled = true;

        const formData = new FormData();
        formData.append('image', originalFile);
        const settings = getCurrentSettings();
        // Append all settings to formData
        Object.keys(settings).forEach(key => {
            // Handle specific cases like checkboxes
            if (key.endsWith('_enabled')) {
                if (settings[key]) formData.append(key, settings[key]);
            } else {
                 formData.append(key, settings[key]);
            }
        });
        
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

            // Add to UI and start polling
            addJobToQueueUI(jobId, imagePreview.src);
            startMasterPolling();

        } catch (error) {
            console.error('Submission Error:', error);
            showToast(`Error: ${error.message}`);
        } finally {
            loader.style.display = 'none';
            applyBtn.disabled = false;
        }
    };

    // --- UNMODIFIED CORE FUNCTIONS ---
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
        num_inference_steps: Number(stepsSlider.value),
        guidance_scale: Number(guidanceSlider.value),
        true_cfg_scale: Number(cfgSlider.value),
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
        stepsSlider.value = stepsNumber.value = stepsValue.textContent = settings.num_inference_steps || 40;
        guidanceSlider.value = guidanceNumber.value = guidanceValue.textContent = settings.guidance_scale || 3.5;
        cfgSlider.value = cfgNumber.value = cfgValue.textContent = settings.true_cfg_scale || 1.5;
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
                settings = appData.app_defaults;
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

    const updateSourceImageFromHistory = async () => {
        if (historyIndex < 0 || historyIndex >= history.length) return;
        const currentImageUrl = history[historyIndex];
        applyBtn.disabled = true;
        try {
            const response = await fetch(currentImageUrl);
            const imageBlob = await response.blob();
            originalFile = new File([imageBlob], `history-image-${Date.now()}.png`, { type: imageBlob.type || 'image/png' });
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
        setTimeout(() => { errorToast.style.display = 'none'; }, 4000);
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
        checkbox.addEventListener('change', () => { input.disabled = !checkbox.checked; });
    };

    const buildStyleProfilesAccordion = (categories) => {
        accordionContainer.innerHTML = '';
        categories.forEach((category, index) => {
            const isActive = index === 0;
            const categoryDiv = document.createElement('div');
            categoryDiv.className = `profile-category ${isActive ? 'active' : ''}`;
            const header = document.createElement('h3');
            header.className = 'profile-category-header';
            header.setAttribute('role', 'button');
            header.setAttribute('aria-expanded', String(isActive));
            header.tabIndex = 0;
            header.innerHTML = `<span>${category.name}</span><span class="header-arrow" aria-hidden="true">▼</span>`;
            const contentDiv = document.createElement('div');
            contentDiv.className = 'profile-buttons profile-category-content';
            category.profiles.forEach(profile => {
                const button = document.createElement('button');
                button.className = 'profile-btn';
                button.dataset.profile = profile.id;
                button.textContent = profile.name;
                contentDiv.appendChild(button);
            });
            categoryDiv.appendChild(header);
            categoryDiv.appendChild(contentDiv);
            accordionContainer.appendChild(categoryDiv);
        });
    };

    async function initializeApp() {
        try {
            const configResponse = await fetch('/config');
            if (!configResponse.ok) throw new Error(`Failed to load configuration: ${configResponse.statusText}`);
            const appConfig = await configResponse.json();
            API_BASE_URL = appConfig.apiBaseUrl;

            const response = await fetch('/static/profiles.json');
            if (!response.ok) throw new Error(`Failed to load profiles.json: ${response.statusText}`);
            appData = await response.json();

            appData.categories.forEach(category => {
                category.profiles.forEach(profile => {
                    profilesMap.set(profile.id, profile.settings);
                });
            });

            buildStyleProfilesAccordion(appData.categories);

            // --- EVENT LISTENERS ---
            imagePreview.addEventListener('load', maybeAdjustResolution);
            uploadArea.addEventListener('click', () => !uploadArea.classList.contains('disabled') && fileInput.click());
            fileInput.addEventListener('change', (e) => handleFileUpload(e.target.files[0]));
            ['dragover', 'dragleave', 'drop'].forEach(eventName => {
                uploadArea.addEventListener(eventName, e => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (uploadArea.classList.contains('disabled')) return;
                    if (eventName === 'dragover') uploadArea.classList.add('drag-over');
                    if (eventName === 'dragleave') uploadArea.classList.remove('drag-over');
                    if (eventName === 'drop') {
                        uploadArea.classList.remove('drag-over');
                        handleFileUpload(e.dataTransfer.files[0]);
                    }
                });
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
            accordionContainer.addEventListener('click', (e) => {
                const button = e.target.closest('.profile-btn');
                if (button) loadSettings(button.dataset.profile);
            });
            advancedSettingsHeader.addEventListener('click', () => {
                const isExpanded = advancedSettingsHeader.getAttribute('aria-expanded') === 'true';
                advancedSettingsHeader.setAttribute('aria-expanded', !isExpanded);
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

            // --- FINAL INITIALIZATION ---
            loadSettings('default');
            populateCustomProfiles();
            loadJobsFromStorage(); // Load and poll existing jobs

        } catch (error) {
            console.error("Initialization failed:", error);
            showToast("Error: Could not load application configuration.");
        }
    }

    initializeApp();
});