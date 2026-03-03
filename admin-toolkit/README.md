# Diagnostics

Admin toolkit for Dataiku DSS instances — health scoring, outreach campaigns, auditing, and cleanup.

Connects live to the DSS instance via the Dataiku Python API. No file uploads or diagnostic bundles needed — all data is fetched in real time from the running instance through a Flask backend with 38+ API endpoints.

## Features at a Glance

| Section | Page | What it shows |
|---------|------|---------------|
| Overview | Summary | Health score, system facts, version info |
| Overview | Issues | Disabled features, configuration warnings |
| Infrastructure | Filesystem | Disk usage across all mount points |
| Infrastructure | Memory | RAM and swap breakdown |
| Infrastructure | Dir Usage | Treemap of datadir space consumption |
| Insights | Projects | Project inventory with footprint and permissions |
| Insights | Code Envs | Python environments, version distribution, ownership |
| Insights | Connections | Connection types and counts |
| Configuration | Runtime | Java heap, Spark settings, resource limits |
| Configuration | Security | Auth config, user isolation, cgroups |
| Configuration | Platform | Containers, integrations, proxy settings |
| Logs | Errors | Backend log errors with context |
| Tools | Outreach | Email campaigns targeting unhealthy patterns |
| Tools | Cleaner | Code environment cleanup utility |
| Tools | Plugins | Installed plugin inventory and comparison |
| Tools | Tracking | Health score tracking over time |
| Tools | Settings | Thresholds, preferences, configuration |

## Overview

### Summary

The landing page. Displays the composite health score as a gauge, key system facts (DSS version, Python version, Spark version, CPU cores, OS), and a quick snapshot of the instance state.

- Health score with category breakdown
- DSS version, last restart time
- License info and user counts
- Alert banner for critical issues

### Issues

Lists all disabled features and configuration warnings detected on the instance.

- Disabled feature flags with descriptions
- Badge counter visible in the sidebar
- Sortable and filterable table

## Infrastructure

### Filesystem

Visualizes disk usage across all mounted filesystems reported by the instance.

- Usage bars for each mount point
- Warning thresholds at 70% and 90%
- Total vs. used vs. available space

### Memory

Breaks down system memory allocation — physical RAM and swap.

- Physical memory: total, used, free, cached, buffers
- Swap usage
- Visual bar chart

### Dir Usage

Analyzes space consumption within the DSS data directory.

- Interactive treemap / sunburst visualization
- Drill-down into subdirectories
- Flat table view with cumulative sizes

## Insights

### Projects

Inventory of all projects on the instance with footprint metrics.

- Project key, name, owner, DSS version
- Permissions matrix per project
- Code env and Code Studio counts
- Scenario and flow object counts

### Code Envs

Lists all Python code environments with version and usage details.

- Python version distribution chart
- Owner and creation info
- Usage count per environment
- Identification of deprecated Python versions (2.x, 3.6, 3.7)

### Connections

Shows all configured data connections grouped by type.

- Connection type breakdown (HDFS, SQL, S3, etc.)
- Count per type
- Visual chart

## Configuration

### Runtime

Java memory settings, Spark configuration, and resource limits.

- Java heap for Backend, JEK, FEK processes
- Spark version and settings
- Resource limit configuration

### Security

Authentication and isolation settings.

- Auth method (LDAP, SSO, SAML, OIDC, local)
- User isolation / impersonation status
- CGroups configuration and targets
- User and group statistics

### Platform

Container execution, integrations, and network configuration.

- Container/Kubernetes settings
- Integration configuration
- Proxy settings

## Logs

### Errors

Backend log errors extracted with surrounding context for debugging.

- Error entries with timestamps and log levels
- Before/after context lines for each error
- Badge counter in the sidebar when errors are present

## Tools

### Outreach

Email campaign system for notifying project owners about unhealthy patterns. Select a campaign, review the affected recipients, preview the email, and send — all from the UI.

| Campaign | Targets |
|----------|---------|
| Code Env Sprawl | Projects with too many code environments |
| Code Env Ownership | Projects using code envs they don't own |
| Code Studio Sprawl | Projects with too many Code Studios |
| Auto-Start Scenarios | Projects with auto-start scenarios |
| Projects owned by disabled users | Projects owned by disabled user accounts that need reassignment |
| Deprecated Python Versions | Code envs using Python 2.x, 3.6, 3.7 |
| Missing Default Code Env | Projects with code envs but no default Python environment |
| Overshared Projects | Projects with 20+ permission entries |
| High-Frequency Scenarios | Scenarios running more often than every 30 min |
| Empty Projects | Projects with no code envs, no Code Studios, and minimal data |
| Large Flow Projects | Projects with 100+ flow objects |
| Orphan Notebooks | Projects with many notebooks but few recipes |
| Failing Scenarios | Scenarios whose last run failed or was aborted |
| Inactive Projects | 180+ days inactive, no active scenarios or deployed bundles |
| Unused Code Envs | Code environments with zero usages |

Each campaign supports:
- Recipient preview with exemption management
- Email template preview before sending
- Per-campaign send history

### Cleaner

Code environment cleanup tool for removing unused or orphaned environments.

- Lists code envs with zero usages
- Bulk selection and deletion
- Safety checks before removal

### Plugins

Installed plugin inventory with version details.

- Plugin list with versions
- Cross-instance plugin comparison

### Tracking

Health score history over time.

- Snapshot-based tracking of the composite health score
- Trend visualization across check-ins

### Settings

Configure thresholds and preferences used across the toolkit.

- Health score factor toggles
- Threshold values for campaigns and issue detection
- UI preferences

## Health Score

The composite health score (0–100) is calculated from six weighted categories:

| Category | Weight |
|----------|--------|
| Code Environments | 35% |
| Project Footprint | 30% |
| System Capacity | 15% |
| Security & Isolation | 10% |
| Version Currency | 5% |
| Runtime Config | 5% |

Each category score is derived from **12 toggleable health factors** that can be individually enabled or disabled in Settings:

- **Python versions** — penalizes deprecated Python (2.x, 3.6, 3.7)
- **Spark version** — checks for Spark 3.x adoption
- **Memory availability** — system RAM headroom
- **Filesystem capacity** — disk usage across mounts
- **Open files limit** — ulimit threshold (should be 65535+)
- **User isolation** — impersonation / multi-user separation
- **CGroups enabled** — resource control via cgroups
- **CGroups empty targets** — cgroups configured but with no targets
- **Code envs per project** — flags projects with excessive code envs
- **Project size pressure** — large flow and dataset counts
- **Disabled features** — critical features that are turned off
- **Java memory limits** — JVM heap below recommended thresholds

## Tips

- **Cmd+K / Ctrl+K** — Open the command palette to jump to any page by name or keyword
- **Collapsible sidebar** — Click the toggle to collapse the sidebar for more screen space
- **Dark mode** — Automatically follows your system theme
- **Badge counters** — The sidebar shows badge counts on Issues and Errors when items are detected
