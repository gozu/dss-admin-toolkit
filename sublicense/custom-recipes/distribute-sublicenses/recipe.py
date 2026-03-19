import dataiku
import dataikuapi
import pandas as pd, numpy as np
import json

# Import the helpers for custom recipes
from dataiku.customrecipe import get_input_names_for_role
from dataiku.customrecipe import get_output_names_for_role
from dataiku.customrecipe import get_recipe_config

# For inputs:
allocate_sublicenses = get_input_names_for_role('allocate_sublicenses')
allocate_sublicenses_dataset = dataiku.Dataset(allocate_sublicenses[0])

# For outputs, the process is the same:
sublicense_output = get_output_names_for_role('sublicense_output')
sublicense_output_dataset = dataiku.Dataset(sublicense_output[0])

total_allocation = get_output_names_for_role('total_allocation')
total_allocation_dataset = dataiku.Dataset(total_allocation[0])

# Collect recipe parameters
nodes = get_recipe_config()['nodes']
master_license_string_raw = get_recipe_config()['master-license'][0]['License JSON']
master_license = json.loads(master_license_string_raw)

# Collect sublicense values from dataset
df = allocate_sublicenses_dataset.get_dataframe()
df_as_dict = [
    {row['NodeID']: row.drop('NodeID').to_dict()} 
    for _, row in df.iterrows()
]

# Add up current total usage
subtotal_df = df.groupby(lambda _: 'Grand Total').sum()#.drop('NodeID', axis=1)
subtotal_dict = subtotal_df.to_dict(orient='records')[0]
subtotal_dict['Metric'] = 'Current'

# Collect total from master license
totals = {k: v for k, v in master_license['content']['properties'].items() if k.startswith('max')}
key_map = {
    'maxFullDesigners': 'FULL_DESIGNER',
    'maxAdvancedAnalyticsDesigners': 'ADVANCED_ANALYTICS_DESIGNER',
    'maxDataDesigners': 'DATA_DESIGNER',
    'maxGovernanceManagers': 'GOVERNANCE_MANAGER',
    'maxReaders': 'READER',
    'maxAIConsumers': 'AI_CONSUMER',
    'maxAIAccessUsers': 'AI_ACCESS_USER',
    'maxTechnicalAccounts': 'TECHNICAL_ACCOUNT'
}
totals_remapped = {key_map.get(k, k): v for k, v in totals.items()}
totals_remapped['Metric'] = 'Max'

# Check that license allocations are ok!
remaining_dict = {
    k: int(totals_remapped[k]) - subtotal_dict[k]
    for k in totals_remapped if k != 'Metric'
}

try:
    # Check if any numeric values are negative
    if any(v < 0 for k, v in remaining_dict.items()):
        # We "raise" the error manually because Python doesn't 
        # consider a negative number an automatic "crash"
        raise ValueError("You have exceeded one or more license counts!")

except ValueError as e:
    # This block only runs if the 'raise' above was triggered
    print(f"An error occurred: {e}")
    raise

# Allocate sublicenses across nodes, if tests passed above
for node in zip(df_as_dict, nodes):
    client = dataikuapi.DSSClient(node[1]['node_URL'], node[1]['API_Key'], no_check_certificate=True)
    sublicense = node[0][node[1]['node_name']]
    master_license_new = master_license.copy()
    master_license_new['sublicense'] = {"profileLimits": sublicense}
    client.set_license(json.dumps(master_license_new))
    
# Combine total from master license with current total usage
summary_df = pd.DataFrame([subtotal_dict, totals_remapped])

# Write recipe outputs
sublicense_output_dataset.write_with_schema(df)
total_allocation_dataset.write_with_schema(summary_df)
