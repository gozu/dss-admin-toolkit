import dataiku
import dataikuapi
import pandas as pd, numpy as np
import json

# Import the helpers for custom recipes
from dataiku.customrecipe import get_input_names_for_role
from dataiku.customrecipe import get_output_names_for_role
from dataiku.customrecipe import get_recipe_config

# For outputs, the process is the same:
sublicense_allocation = get_output_names_for_role('sublicense_allocation')
sublicense_allocation_dataset = dataiku.Dataset(sublicense_allocation[0])

# Collect recipe parameters
nodes = get_recipe_config()['nodes']
master_license_string_raw = get_recipe_config()['master-license'][0]['License JSON']
master_license = json.loads(master_license_string_raw)

# Collect sublicense values from nodes
node_sublicenses = []
for node in nodes:
    client = dataikuapi.DSSClient(node['node_URL'], node['API_Key'], no_check_certificate=True)
    try:
        profile_limits = client.get_licensing_status()['base']['sublicense']['profileLimits']
    except:
        profile_limits = {
                "FULL_DESIGNER": 0,
                "DATA_DESIGNER": 0,
                "TECHNICAL_ACCOUNT": 0,
                "ADVANCED_ANALYTICS_DESIGNER": 0,
                "GOVERNANCE_MANAGER": 0,
                "AI_CONSUMER": 0,
                "READER": 0,
                "AI_ACCESS_USER": 0
        }
    profile_limits['NodeID'] = node['node_name']
    node_sublicenses.append(profile_limits)
node_sublicenses_df = pd.DataFrame(node_sublicenses)

# Write recipe outputs
sublicense_allocation_dataset.write_with_schema(node_sublicenses_df)
