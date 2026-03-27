import dataiku
import dataikuapi
import pandas as pd, numpy as np
import json
from collections import defaultdict

# Import the helpers for custom recipes
from dataiku.customrecipe import get_input_names_for_role
from dataiku.customrecipe import get_output_names_for_role
from dataiku.customrecipe import get_recipe_config

# Find duplicate users
def find_duplicate_users(df):
    # Group by 'login' and 'profile', and aggregate 'nodeID' into a list
    grouped = df.groupby(['login', 'profile'])['nodeID'].agg(list).reset_index()
    
    # Filter to keep only the groups that have duplicates (more than 1 nodeID)
    duplicates = grouped[grouped['nodeID'].str.len() > 1]
            
    return duplicates

# For outputs, the process is the same:
sublicense_allocation = get_output_names_for_role('sublicense_allocation')
sublicense_allocation_dataset = dataiku.Dataset(sublicense_allocation[0])

duplicate_users = get_output_names_for_role('duplicate_users')
duplicate_users_dataset = dataiku.Dataset(duplicate_users[0])

# Collect recipe parameters
nodes = get_recipe_config()['nodes']
master_license_string_raw = get_recipe_config()['master-license'][0]['License JSON']
master_license = json.loads(master_license_string_raw)

print('DEBBUG!')
print(nodes)
print(master_license_string_raw)

# Collect sublicense values from nodes
node_sublicenses = []
node_user_metadata = []
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
    
    user_metadata = []
    for user in client.list_users():
        enabled = user['enabled']
        if enabled:
            login = user['login']
            profile = user['userProfile']
            user_metadata.append({'nodeID': node['node_name'], 'login': login, 'profile': profile})
            
    node_user_metadata.append(user_metadata)

# Create and write the node_sublicenses output dataset    
node_sublicenses_df = pd.DataFrame(node_sublicenses)    
sublicense_allocation_dataset.write_with_schema(node_sublicenses_df)

# Create and write the duplicates output dataset, using the find_duplicate_users function 
node_user_metadata_flat = [item for sublist in node_user_metadata for item in sublist]
node_user_metadata_df = pd.DataFrame(node_user_metadata_flat)
duplicates_df = find_duplicate_users(node_user_metadata_df)
duplicate_users_dataset.write_with_schema(duplicates_df)
