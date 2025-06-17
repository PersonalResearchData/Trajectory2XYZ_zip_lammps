// Global variables
let pyodide = null;
let filesData = [];

// Initialize Pyodide when page loads
window.addEventListener('DOMContentLoaded', async () => {
    const form = document.getElementById('parserForm');
    form.addEventListener('submit', handleFormSubmit);
    
    // Pre-load Pyodide in the background
    loadPyodideAndPackages();
});

// Load Pyodide
async function loadPyodideAndPackages() {
    if (!pyodide) {
        try {
            pyodide = await loadPyodide();
            console.log('Pyodide loaded successfully');
        } catch (error) {
            console.error('Failed to load Pyodide:', error);
        }
    }
    return pyodide;
}

// Handle form submission
async function handleFormSubmit(e) {
    e.preventDefault();
    
    const fileInput = document.getElementById('fileInput');
    const startTimestep = parseInt(document.getElementById('startTimestep').value);
    const endTimestep = parseInt(document.getElementById('endTimestep').value);
    const zipOption = document.getElementById('zipOption').checked;
    
    // Validate inputs
    if (!fileInput.files[0]) {
        showError('Please upload a LAMMPS trajectory file.');
        return;
    }
    
    if (isNaN(startTimestep) || isNaN(endTimestep) || startTimestep > endTimestep) {
        showError('Please enter valid start and end timesteps.');
        return;
    }
    
    // Process file
    await processFile(fileInput.files[0], startTimestep, endTimestep, zipOption);
}

// Process the LAMMPS file
async function processFile(file, startTimestep, endTimestep, zipOption) {
    // Show progress
    showProgress();
    
    // Reset files data
    filesData = [];
    
    try {
        // Read file content
        const fileContent = await file.text();
        const fileName = file.name;
        
        // Ensure Pyodide is loaded
        const py = await loadPyodideAndPackages();
        
        // Set Python globals
        py.globals.set('file_content', fileContent);
        py.globals.set('file_name', fileName);
        py.globals.set('start_timestep', startTimestep);
        py.globals.set('end_timestep', endTimestep);
        
        // Define window function for Python to call
        window.store_file_data = function(filename, content) {
            filesData.push({ filename, content });
        };
        
        // Run Python code
        const result = await py.runPythonAsync(getPythonCode());
        
        // Show results
        showOutput(result);
        
        // Handle downloads if files were generated
        if (filesData.length > 0) {
            await handleDownloads(zipOption, startTimestep, endTimestep);
        }
        
    } catch (error) {
        showError(`Error processing file: ${error.message}`);
    }
}

// Handle file downloads
async function handleDownloads(zipOption, startTimestep, endTimestep) {
    const outputDiv = document.getElementById('output');
    
    outputDiv.textContent += '\n\nPreparing download...';
    
    if (zipOption) {
        // Create and download ZIP file
        try {
            const zip = new JSZip();
            
            // Add all files to ZIP
            filesData.forEach(file => {
                zip.file(file.filename, file.content);
            });
            
            // Generate ZIP file
            const content = await zip.generateAsync({ type: 'blob' });
            
            // Download ZIP
            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = `lammps_xyz_files_${startTimestep}_to_${endTimestep}.zip`;
            a.click();
            URL.revokeObjectURL(url);
            
            outputDiv.textContent += '\n\n✅ ZIP file downloaded successfully!';
            showSuccess('ZIP file downloaded successfully!');
            
        } catch (error) {
            showError(`Error creating ZIP file: ${error.message}`);
        }
    } else {
        // Download individual files
        filesData.forEach((file, index) => {
            setTimeout(() => {
                const blob = new Blob([file.content], { type: 'text/plain' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = file.filename;
                a.click();
                URL.revokeObjectURL(url);
            }, index * 100); // Stagger downloads
        });
        
        outputDiv.textContent += '\n\n✅ Individual files downloaded successfully!';
        showSuccess('Individual files downloaded successfully!');
    }
}

// UI Helper Functions
function showProgress() {
    document.getElementById('progressSection').classList.remove('d-none');
    document.getElementById('outputSection').classList.add('d-none');
    document.getElementById('processBtn').disabled = true;
}

function showOutput(content) {
    document.getElementById('progressSection').classList.add('d-none');
    document.getElementById('outputSection').classList.remove('d-none');
    document.getElementById('output').textContent = content;
    document.getElementById('processBtn').disabled = false;
}

function showError(message) {
    document.getElementById('progressSection').classList.add('d-none');
    document.getElementById('outputSection').classList.remove('d-none');
    document.getElementById('output').textContent = `❌ Error: ${message}`;
    document.getElementById('processBtn').disabled = false;
    
    // Show Bootstrap alert
    showAlert(message, 'danger');
}

function showSuccess(message) {
    showAlert(message, 'success');
}

function showAlert(message, type) {
    const alertDiv = document.createElement('div');
    alertDiv.className = `alert alert-${type} alert-dismissible fade show mt-3`;
    alertDiv.innerHTML = `
        ${message}
        <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
    `;
    
    const container = document.querySelector('.card-body');
    container.appendChild(alertDiv);
    
    // Auto-dismiss after 5 seconds
    setTimeout(() => {
        alertDiv.remove();
    }, 5000);
}

// Python code as a function
function getPythonCode() {
    return `
import js

def parse_lammps(file_content, file_name, start_timestep, end_timestep):
    try:
        xyz_files = []
        found_timesteps = []
        output_log = []
        lines = file_content.split('\\n')
        i = 0
        current_timestep = None
        atoms = []
        xbounds = None
        ybounds = None
        zbounds = None
        N = 0
        reading_atoms = False

        while i < len(lines):
            line = lines[i].strip()
            if not line:
                if reading_atoms and atoms and current_timestep is not None and current_timestep >= start_timestep and current_timestep <= end_timestep:
                    xyz_content = f"{N}\\n"
                    xyz_content += f"Timestep {current_timestep} from {file_name} box {xbounds[0]:.6f} {xbounds[1]:.6f} {ybounds[0]:.6f} {ybounds[1]:.6f} {zbounds[0]:.6f} {zbounds[1]:.6f}\\n"
                    for at in atoms:
                        xyz_content += f"{at[0]} {at[1]:.6f} {at[2]:.6f} {at[3]:.6f}\\n"
                    xyz_filename = f"output_timestep_{current_timestep}.xyz"
                    xyz_files.append((xyz_filename, xyz_content))
                    found_timesteps.append(current_timestep)
                i += 1
                if i >= len(lines):
                    break
                continue

            if line == "ITEM: TIMESTEP":
                if reading_atoms and atoms and current_timestep is not None and current_timestep >= start_timestep and current_timestep <= end_timestep:
                    xyz_content = f"{N}\\n"
                    xyz_content += f"Timestep {current_timestep} from {file_name} box {xbounds[0]:.6f} {xbounds[1]:.6f} {ybounds[0]:.6f} {ybounds[1]:.6f} {zbounds[0]:.6f} {zbounds[1]:.6f}\\n"
                    for at in atoms:
                        xyz_content += f"{at[0]} {at[1]:.6f} {at[2]:.6f} {at[3]:.6f}\\n"
                    xyz_filename = f"output_timestep_{current_timestep}.xyz"
                    xyz_files.append((xyz_filename, xyz_content))
                    found_timesteps.append(current_timestep)
                
                i += 1
                if i >= len(lines):
                    break
                ts_line = lines[i].strip()
                try:
                    current_timestep = int(ts_line)
                except ValueError:
                    output_log.append(f"Error: Invalid timestep value at line {i+1}")
                    break
                atoms = []
                reading_atoms = False
                i += 1

            elif line == "ITEM: NUMBER OF ATOMS":
                i += 1
                if i >= len(lines):
                    break
                N_line = lines[i].strip()
                try:
                    N = int(N_line)
                except ValueError:
                    output_log.append(f"Error: Invalid number of atoms at line {i+1}")
                    break
                i += 1

            elif line == "ITEM: BOX BOUNDS pp pp pp":
                i += 1
                if i >= len(lines):
                    break
                try:
                    xbounds = list(map(float, lines[i].strip().split()))
                    i += 1
                    if i >= len(lines):
                        break
                    ybounds = list(map(float, lines[i].strip().split()))
                    i += 1
                    if i >= len(lines):
                        break
                    zbounds = list(map(float, lines[i].strip().split()))
                    i += 1
                except ValueError:
                    output_log.append(f"Error: Invalid box bounds at line {i+1}")
                    break

            elif line == "ITEM: ATOMS id type xs ys zs":
                reading_atoms = True
                for _ in range(N):
                    i += 1
                    if i >= len(lines):
                        break
                    line = lines[i].strip().split()
                    if len(line) < 5:
                        output_log.append(f"Error: Incomplete atom data at line {i+1}")
                        continue
                    try:
                        id_at = int(line[0])
                        type_at = int(line[1])
                        xs = float(line[2])
                        ys = float(line[3])
                        zs = float(line[4])
                        x = xbounds[0] + xs * (xbounds[1] - xbounds[0])
                        y = ybounds[0] + ys * (ybounds[1] - ybounds[0])
                        z = zbounds[0] + zs * (zbounds[1] - zbounds[0])
                        atoms.append((type_at, x, y, z))
                    except (ValueError, IndexError):
                        output_log.append(f"Error: Invalid atom data at line {i+1}")
                        continue
                i += 1
            else:
                i += 1

        # Process last timestep if needed
        if reading_atoms and atoms and current_timestep is not None and current_timestep >= start_timestep and current_timestep <= end_timestep:
            xyz_content = f"{N}\\n"
            xyz_content += f"Timestep {current_timestep} from {file_name} box {xbounds[0]:.6f} {xbounds[1]:.6f} {ybounds[0]:.6f} {ybounds[1]:.6f} {zbounds[0]:.6f} {zbounds[1]:.6f}\\n"
            for at in atoms:
                xyz_content += f"{at[0]} {at[1]:.6f} {at[2]:.6f} {at[3]:.6f}\\n"
            xyz_filename = f"output_timestep_{current_timestep}.xyz"
            xyz_files.append((xyz_filename, xyz_content))
            found_timesteps.append(current_timestep)

        # Store files and generate output log
        if xyz_files:
            for filename, content in xyz_files:
                js.store_file_data(filename, content)
                output_log.append(f"✓ Processed: {filename}")
        else:
            output_log.append("⚠️ No XYZ files were generated.")

        if found_timesteps:
            output_log.append(f"\\n📊 Summary:")
            output_log.append(f"Generated XYZ files for timesteps: {found_timesteps}")
            output_log.append(f"Total files: {len(xyz_files)}")
        else:
            output_log.append(f"\\n⚠️ No timesteps found in the range {start_timestep} to {end_timestep}.")

        return "\\n".join(output_log)
    except Exception as e:
        return f"❌ Unexpected error: {str(e)}"

# Execute the parser
result = parse_lammps(file_content, file_name, start_timestep, end_timestep)
result
`;
}
