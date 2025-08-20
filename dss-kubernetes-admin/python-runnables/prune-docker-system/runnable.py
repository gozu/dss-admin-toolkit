import subprocess
import typing as t
import re
import sys
import logging

from dataiku.runnables import ResultTable, Runnable


def convert_to_gb(size_str: str) -> t.Optional[float]:
    """
    Converts a human-readable size string (e.g., "4.558MB") to gigabytes.

    Args:
        size_str: The size string to convert.

    Returns:
        The size in gigabytes as a float, or None if the format is invalid.
    """
    # Regex to extract the numeric value and the unit
    match = re.match(r"([\d.]+)([KMGT]?B)", size_str.strip())
    if not match:
        return None

    value = float(match.group(1))
    unit = match.group(2)

    # Dictionary to map units to their power of 1024 relative to Bytes
    unit_map = {
        'B': 1,
        'KB': 1024,
        'MB': 1024**2,
        'GB': 1024**3,
        'TB': 1024**4
    }
    
    # Correct mapping for single character units if 'kB' is not present
    if unit in ['K', 'M', 'G', 'T']:
        unit = unit + 'B'
        
    bytes_value = value * unit_map.get(unit, 1)

    # Convert Bytes to Gigabytes
    return bytes_value / unit_map['GB']


def get_docker_build_cache_size() -> t.Optional[float]:
    """
    Executes 'docker system df' and extracts the Build Cache size in GB.

    Returns:
        The size of the build cache in GB as a float, or None on error.
    """
    logging.info("Executing 'docker system df' to check build cache size...")
    
    command = ["docker", "system", "df", "--format", "table {{.Type}}\t{{.Size}}"]
    
    try:
        result = subprocess.run(command, capture_output=True, text=True, check=True)
        
        output_lines = result.stdout.strip().split('\n')
        
        for line in output_lines:
            if "Build Cache" in line:
                size_str = line.split()[-1]
                size_gb = convert_to_gb(size_str)
                return size_gb
                
        logging.info("Build Cache size not found in Docker output.")
        return None
        
    except FileNotFoundError:
        logging.error("Error: 'docker' command not found. Please ensure Docker is installed and in your PATH.")
        return None
    except subprocess.CalledProcessError as e:
        logging.error(f"Error executing Docker command: {e.stderr}")
        return None
    except Exception as e:
        logging.error(f"An unexpected error occurred: {e}")
        return None


def prune_docker_system_if_needed(threshold_gb: float) -> t.Tuple[str, str]:
    """
    Checks the Docker build cache size and prunes the system if it exceeds
    the specified threshold.

    Args:
        threshold_gb: The maximum acceptable cache size in GB.
    
    Returns:
        A tuple of (status, message).
    """
    current_size_gb = get_docker_build_cache_size()
    
    if current_size_gb is None:
        return "Failed", "Could not determine cache size. Pruning aborted."
        
    logging.info(f"Current build cache size: {current_size_gb:.2f} GB")
    logging.info(f"Threshold for pruning: {threshold_gb:.2f} GB")

    if current_size_gb > threshold_gb:
        logging.info("Threshold exceeded. Pruning Docker system...")
        try:
            prune_command = ["docker", "system", "prune", "-f"]
            subprocess.run(prune_command, check=True)
            return "Pruned", "Docker system pruned successfully."
        except subprocess.CalledProcessError as e:
            return "Failed", f"Error pruning Docker system: {e.stderr}"
        except Exception as e:
            return "Failed", f"An unexpected error occurred during pruning: {e}"
    else:
        return "Not Pruned", "Cache size is within the acceptable limit. No action needed."


class PruneDockerSystem(Runnable):
    """
    A runnable to check and prune the Docker system build cache.
    """
    def __init__(self, project_key, config):
        self.config = config

    def run(self, progress_callback: t.Callable[[int], None]) -> ResultTable:
        action = self.config["action"]
        results_table = ResultTable()
        results_table.add_column("action", "Action", "STRING")
        results_table.add_column("status", "Status", "STRING")
        results_table.add_column("details", "Details", "STRING")

        if action == "check":
            size_gb = get_docker_build_cache_size()
            if size_gb is not None:
                results_table.add_record(["Check Cache Size", "Success", f"The build cache size is: {size_gb:.2f} GB"])
            else:
                results_table.add_record(["Check Cache Size", "Failed", "Unable to determine cache size. See logs for details."])
        
        elif action == "prune":
            threshold = self.config["threshold_gb"]
            status, message = prune_docker_system_if_needed(threshold)
            results_table.add_record(["Prune System", status, message])

        return results_table