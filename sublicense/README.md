# Sublicense Plugin

**Version:** 1.0.0

**Sublicense** is an administrative set of Visual Recipes for **Dataiku DSS** which 
service a centralized DSS Project to collect and distribute sublicenses (using a
single Master License) across Dataiku nodes.

It is designed for **Dataiku Platform Admins** who will benefit from the 
functionality of Sublicenses, but who may not have access via Cloudstacks.

## Some Fine Print
- Sublicenses are a cooperative mechanism. It is not technically impossible for the 
administrator of the group who receives the sublicense to alter it. Doing so could 
however put you in breach of your Dataiku License Agreement.
- As this is an initial release, the Plugin operates on an assumption that License Holders 
are duplicative if they have 1) a unique Login and 2) the same Profile across multiple nodes.  
- This is not the strict meaning of a duplicative user, from Dataiku's perspective. Regardless,
to keep development speed high and costs low, we decided to assert this assumption because
in most cases, if a user (with a unique Login) must access a different node with a 
different Profile, they typically will have a "lower level" (eg. "AI Consumer") Profile. 
Said Profiles typically have lower saturation rates than "Full Designer". Thus the "why" behind
our deviation from the strict mean of a duplicative user. If you find that you need 
to revisit this definition of a duplicative user (in the sense of the Plugin), please
reach out to your helpful TAM and we can discuss further.

## Tested Versions
- Built with DSS V14.4.1 and Python 3.11.
- Can work with <DSS V14 (i.e. even V12.6) with relative ease. Just reach out!

## How it works
Once the plugin is installed successfully, an Admin configures their Master Licenses and Nodes (see
**Installation & Setup** below).  After configuration, the Admin next creates a new Project.

### Project 
The Admin creates a Project (again see **Installation & Setup** below) with two Flow Zones: 
"Collect" and "Distribute", which are almost self explanatory:

#### Collect Flow Zone
The start to the Project Flow is to collect existing Sublicense information from each node, using
the Collect Recipe. If there is no current Sublicense information available (or present), then the 
Admin is provided with a "clean slate" Editable Dataset pre-set to zero licenses across all nodes.  

The other relevant information collected is a list of Duplicative Users.

#### Distribute Flow Zone
The end of the Project Flow for the Admin to determine how they want to allocate their sublicenses
across of the nodes. The way this is accomplished is by using an Editable Dataset and modifying
the counts of each license Profile, per node.

Once the allocation is complete, then the Sublicenses are distributed across all nodes. This occurs
by accessing the Master License, then applying a Sublicense JSON component. The Plugin verifies that
total License Allocation is at or below the contracted thresholds.

The results from this section of the Project Flow are:

- A dataset which includes the current allocation of licenses, per Profile and per node
- A dataset which summarizes:
  - The total Licenses allocated, per Profile
  - The total Duplicates, per Profile
  - The Max Licenses allowed (per the Master License), per Profile

## Installation & Setup
### Plugin
1. Install the Plugin.
2. In the Plugin Page, navigate to Settings.
#### Master License Parameter Set
3. On the left panel, select "Master License".
    1. Click +ADD PRESET, name it "Master License", then CREATE.
    2. Paste your Dataiku-issued License.JSON file into "The master license to be distributed."
    3. Assign Permissions, as necessary.
    4. Click SAVE.

![master-license](https://github.com/user-attachments/assets/604321ab-f122-4a7c-ad17-8aa48d2c6451) 

#### Credentials Parameter Set
4. Back on the left panel, select "Credential".
    1. Click +ADD PRESET, name it "Node 1" (or equiv), then CREATE.
    2. Enter "Name of instance".
    3. Enter "URL of instance".
    4. Enter "API Key".
    5. Assign Permissions, as necessary.
    6. Click SAVE.
5. Repeat step above as necessary

![credentials_parameter](https://github.com/user-attachments/assets/6993494d-e3a6-490f-9429-add4d01b048c)

### Project
#### Collect Flow Zone
6. Create a new Project, feel free to call it "Sublicense".
7. In the Flow, click +ADD ITEM and select Other // Recipe // PLUGINS // Sublicense.
8. Create a new "Collect sublicenses" Recipe.
    1. Under "Dataset with current sublicense allocation", click SET and name it "current".
    2. Under "Dataset with duplicate users", click SET and name it "duplicates".
    3. Click CREATE.
9. Select all Nodes and the Master License.
10. Click SAVE then RUN.

![collect_recipe](https://github.com/user-attachments/assets/cfd6fdd7-a738-47ef-9814-9ecf3ad38bb9)

11. Return to the Flow and select "current" dataset, then "Push to editable" Recipe (in Other Recipes)
12. Under the "New editable dataset name", name it "desired". Then CREATE RECIPE.
14. Enter a "Unique key" of "NodeID". Then click SAVE.
15. Navigate to the Output Dataset ("desired"), and under "Settings" **de-select** "Keep track of manual changes". Click SAVE.
16. Navigate back to PARENT RECIPE. Then click RUN.
17. As a best practice, select "desired" dataset and under Flow Zones "Share" the dataset into a new Flow Zone called "Distribute"
18. Rename the "Default" Flow Zone to "Collect".

![collect_zone](https://github.com/user-attachments/assets/0f184faa-5bde-4c19-96e1-0df37b536e7f)

#### Distribute Flow Zone
19. Now comes the fun part!  Edit your Editable Dataset "desired" to include which allocation of licenses you want, per Profile, per Node.
20. In the Flow, click +ADD ITEM and select Other // Recipe // PLUGINS // Sublicense.
21. Create a new "Distribute sublicenses" Recipe.
    1. Under "Dataset with desired sublicense allocation", click SET and select "desired".
    2. Under "Dataset with actual sublicense allocation", click SET and name it "actual".
    3. Under "Dataset with total allocation", click SET and name it "total".
    3. Click CREATE.
22. Leave "Dry Run" Selected (so that you can test out without affecting your live nodes).
23. Select all Nodes and the Master License.
24. Click SAVE then RUN.
25. Return to the Flow and select "Distribute" Recipe, under Flow Zones select "Move". Click MOVE.

#### Rinse and Repeat
24. Based upon results from above, make changes as necessary to your "desired" allocations.
25. After you are fully satisfied, return to the "Distribute" Recipe and uncheck "Dry Run".
26. SAVE, RUN, and relax!

![final_flow](https://github.com/user-attachments/assets/efb7cd06-f415-411f-9a27-061a1a6659c0)

In conclusion, thank you for your continued support of Dataiku. We wish you all well in managing your Sublicense allocations henceforth.

## License 

Copyright (c) 2026 Dataiku

Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in 
compliance with the License. You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under the License is 
distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. 
See the License for the specific language governing permissions and limitations under the License.
