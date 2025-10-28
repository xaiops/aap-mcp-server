import { ToolWithSize } from '../index.js';

interface DashboardData {
  allTools: ToolWithSize[];
  allCategories: Record<string, string[]>;
  recordApiQueries: boolean;
}

export const renderDashboard = (data: DashboardData): string => {
  const { allTools, allCategories, recordApiQueries } = data;

  // Calculate summary statistics
  const totalSize = allTools.reduce((sum, tool) => sum + (tool.size || 0), 0);

  // Calculate category statistics dynamically
  const categoryStats: Record<string, { tools: ToolWithSize[]; size: number }> = {};
  for (const [categoryName, categoryTools] of Object.entries(allCategories)) {
    const tools = allTools.filter(tool => categoryTools.includes(tool.name));
    categoryStats[categoryName] = {
      tools,
      size: tools.reduce((sum, tool) => sum + (tool.size || 0), 0)
    };
  }

  // Count tools by service
  const serviceStats = allTools.reduce((acc, tool) => {
    const service = tool.service || 'unknown';
    acc[service] = (acc[service] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AAP MCP Dashboard</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
        }
        .container {
            max-width: 1560px;
            margin: 0 auto;
        }
        .header {
            text-align: center;
            color: white;
            margin-bottom: 40px;
        }
        .header h1 {
            font-size: 3em;
            margin: 0;
            text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
        }
        .header p {
            font-size: 1.2em;
            opacity: 0.9;
            margin: 10px 0;
        }
        .main-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(350px, 1fr));
            gap: 30px;
            margin-bottom: 40px;
        }
        .card {
            background: white;
            border-radius: 15px;
            padding: 30px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .card:hover {
            transform: translateY(-5px);
            box-shadow: 0 15px 40px rgba(0,0,0,0.3);
        }
        .card-header {
            display: flex;
            align-items: center;
            margin-bottom: 20px;
        }
        .card-icon {
            width: 60px;
            height: 60px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 1.5em;
            font-weight: bold;
            margin-right: 20px;
        }
        .tools-icon { background: linear-gradient(45deg, #007acc, #0056b3); }
        .categories-icon { background: linear-gradient(45deg, #28a745, #1e7e34); }
        .card-title {
            font-size: 1.8em;
            font-weight: bold;
            color: #333;
            margin: 0;
        }
        .card-description {
            color: #666;
            margin-bottom: 25px;
            line-height: 1.6;
        }
        .card-stats {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
            gap: 15px;
            margin-bottom: 25px;
        }
        .stat {
            text-align: center;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 8px;
        }
        .stat-number {
            font-size: 1.5em;
            font-weight: bold;
            color: #333;
        }
        .stat-label {
            font-size: 0.8em;
            color: #666;
            text-transform: uppercase;
            margin-top: 5px;
        }
        .btn {
            display: inline-block;
            background: linear-gradient(45deg, #007acc, #0056b3);
            color: white;
            padding: 12px 30px;
            text-decoration: none;
            border-radius: 25px;
            font-weight: bold;
            transition: all 0.3s ease;
            text-align: center;
        }
        .btn:hover {
            background: linear-gradient(45deg, #0056b3, #004085);
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0,123,204,0.4);
            text-decoration: none;
            color: white;
        }
        .btn-categories {
            background: linear-gradient(45deg, #28a745, #1e7e34);
        }
        .btn-categories:hover {
            background: linear-gradient(45deg, #1e7e34, #155724);
            box-shadow: 0 5px 15px rgba(40,167,69,0.4);
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 40px;
        }
        .summary-card {
            background: rgba(255,255,255,0.1);
            border-radius: 10px;
            padding: 20px;
            color: white;
            text-align: center;
        }
        .summary-card h3 {
            margin-top: 0;
            font-size: 1.1em;
            opacity: 0.9;
        }
        .summary-number {
            font-size: 2em;
            font-weight: bold;
            margin: 10px 0;
        }
        .service-stats {
            display: flex;
            gap: 15px;
            flex-wrap: wrap;
            justify-content: center;
        }
        .service-badge {
            padding: 5px 12px;
            border-radius: 15px;
            font-size: 0.9em;
            font-weight: bold;
        }
        .service-eda { background: #2196f3; color: white; }
        .service-controller { background: #9c27b0; color: white; }
        .service-gateway { background: #4caf50; color: white; }
        .service-galaxy { background: #ff9800; color: white; }
        .service-unknown { background: #f44336; color: white; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>AAP MCP Dashboard</h1>
            <p>Ansible Automation Platform Model Context Protocol Interface</p>
        </div>

        <div class="summary-grid">
            <div class="summary-card">
                <h3>Total Tools</h3>
                <div class="summary-number">${allTools.length}</div>
            </div>
            <div class="summary-card">
                <h3>Total Size</h3>
                <div class="summary-number">${Math.round(totalSize / 1000)}K</div>
                <small>characters</small>
            </div>
            <div class="summary-card">
                <h3>Services</h3>
                <div class="summary-number">${Object.keys(serviceStats).length}</div>
            </div>
            <div class="summary-card">
                <h3>Categories</h3>
                <div class="summary-number">${Object.keys(allCategories).length}</div>
            </div>
        </div>

        <div class="main-grid">
            <div class="card">
                <div class="card-header">
                    <div class="card-icon tools-icon">🔧</div>
                    <h2 class="card-title">Tools</h2>
                </div>
                <p class="card-description">
                    Browse and explore all available MCP tools. Each tool provides access to specific AAP functionality across different services including EDA, Controller, Gateway, and Galaxy.
                </p>
                <div class="card-stats">
                    <div class="stat">
                        <div class="stat-number">${allTools.length}</div>
                        <div class="stat-label">Total Tools</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${Object.keys(serviceStats).length}</div>
                        <div class="stat-label">Services</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${Math.round(totalSize / 1000)}K</div>
                        <div class="stat-label">Characters</div>
                    </div>
                </div>
                <div class="service-stats">
                    ${Object.entries(serviceStats).map(([service, count]) =>
                        `<span class="service-badge service-${service}">${service}: ${count}</span>`
                    ).join('')}
                </div>
                <br><br>
                <a href="/tools" class="btn">Browse All Tools</a>
            </div>

            <div class="card">
                <div class="card-header">
                    <div class="card-icon" style="background: linear-gradient(45deg, #ff6b6b, #ee5a24);">🏗️</div>
                    <h2 class="card-title">Services</h2>
                </div>
                <p class="card-description">
                    Explore the different AAP services that provide the tools. Each service represents a different component of the Ansible Automation Platform ecosystem.
                </p>
                <div class="card-stats">
                    <div class="stat">
                        <div class="stat-number">${Object.keys(serviceStats).length}</div>
                        <div class="stat-label">Services</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${allTools.length}</div>
                        <div class="stat-label">Total Tools</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${Math.round(totalSize / 1000)}K</div>
                        <div class="stat-label">Characters</div>
                    </div>
                </div>
                <div class="service-stats">
                    ${Object.entries(serviceStats).map(([service, count]) =>
                        `<span class="service-badge service-${service}">${service}: ${count}</span>`
                    ).join('')}
                </div>
                <br><br>
                <a href="/services" class="btn" style="background: linear-gradient(45deg, #ff6b6b, #ee5a24);">Explore Services</a>
            </div>

            <div class="card">
                <div class="card-header">
                    <div class="card-icon categories-icon">👥</div>
                    <h2 class="card-title">Categories</h2>
                </div>
                <p class="card-description">
                    Understand the different user categories and their tool access levels. Categories control which tools are available based on user permissions and authentication status.
                </p>
                <div class="card-stats">
                    ${Object.entries(categoryStats).map(([categoryName, stats]) => `
                    <div class="stat">
                        <div class="stat-number">${stats.tools.length} tools</div>
                        <div class="stat-label">${categoryName.charAt(0).toUpperCase() + categoryName.slice(1)}</div>
                    </div>
                    `).join('')}
                </div>
                <br>
                <a href="/category" class="btn btn-categories">Explore Categories</a>
            </div>

            <div class="card">
                <div class="card-header">
                    <div class="card-icon" style="background: linear-gradient(45deg, #ffc107, #e67e22);">🔗</div>
                    <h2 class="card-title">API Endpoints</h2>
                </div>
                <p class="card-description">
                    Browse all API endpoints organized by service. View HTTP methods, paths, and descriptions for each endpoint across the AAP platform services.
                </p>
                <div class="card-stats">
                    <div class="stat">
                        <div class="stat-number">${allTools.length}</div>
                        <div class="stat-label">Endpoints</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${Object.keys(serviceStats).length}</div>
                        <div class="stat-label">Services</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${[...new Set(allTools.map(t => t.method.toUpperCase()))].length}</div>
                        <div class="stat-label">HTTP Methods</div>
                    </div>
                </div>
                <br>
                <a href="/endpoints" class="btn" style="background: linear-gradient(45deg, #ffc107, #e67e22);">View API Endpoints</a>
            </div>

            ${recordApiQueries ? `
            <div class="card">
                <div class="card-header">
                    <div class="card-icon" style="background: linear-gradient(45deg, #17a2b8, #138496);">📊</div>
                    <h2 class="card-title">Request Logs</h2>
                </div>
                <p class="card-description">
                    View detailed logs of API requests made through the MCP interface. Monitor tool usage, response codes, and client information for debugging and analytics.
                </p>
                <div class="card-stats">
                    <div class="stat">
                        <div class="stat-number">1000</div>
                        <div class="stat-label">Recent Requests</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">Live</div>
                        <div class="stat-label">Real-time</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">JSONL</div>
                        <div class="stat-label">Format</div>
                    </div>
                </div>
                <br>
                <a href="/logs" class="btn" style="background: linear-gradient(45deg, #17a2b8, #138496);">View Request Logs</a>
            </div>
            ` : ''}
        </div>
    </div>
</body>
</html>`;
};

export type { DashboardData };