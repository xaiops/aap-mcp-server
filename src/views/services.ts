import { ToolWithSize } from '../index.js';

interface ServiceData {
  name: string;
  displayName: string;
  toolCount: number;
  totalSize: number;
  description: string;
}

interface ServicesOverviewData {
  services: ServiceData[];
  allTools: ToolWithSize[];
}

interface ServiceToolsData {
  serviceName: string;
  displayName: string;
  serviceTools: ToolWithSize[];
  totalSize: number;
  methods: string[];
}

export const renderServicesOverview = (data: ServicesOverviewData): string => {
  const { services, allTools } = data;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Services Overview - AAP MCP</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1000px;
            margin: 0 auto;
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            border-bottom: 2px solid #007acc;
            padding-bottom: 10px;
        }
        .navigation {
            margin-bottom: 30px;
        }
        .nav-link {
            background-color: #6c757d;
            color: white;
            padding: 6px 12px;
            text-decoration: none;
            border-radius: 4px;
            margin-right: 10px;
            font-size: 0.9em;
        }
        .nav-link:hover {
            background-color: #5a6268;
        }
        .services-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .service-card {
            border: 2px solid #e9ecef;
            border-radius: 8px;
            padding: 20px;
            text-decoration: none;
            color: inherit;
            transition: all 0.3s ease;
            cursor: pointer;
        }
        .service-card:hover {
            border-color: #007acc;
            box-shadow: 0 4px 8px rgba(0,0,0,0.1);
            transform: translateY(-2px);
            text-decoration: none;
            color: inherit;
        }
        .service-header {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
        }
        .service-icon {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            margin-right: 15px;
            font-size: 1.2em;
        }
        .service-title {
            font-size: 1.3em;
            font-weight: bold;
            margin: 0;
        }
        .service-description {
            color: #6c757d;
            margin-bottom: 15px;
            line-height: 1.4;
        }
        .service-stats {
            display: flex;
            justify-content: space-between;
            background-color: #f8f9fa;
            padding: 10px;
            border-radius: 5px;
        }
        .stat {
            text-align: center;
        }
        .stat-number {
            font-size: 1.2em;
            font-weight: bold;
            color: #333;
        }
        .stat-label {
            font-size: 0.8em;
            color: #666;
        }
        .service-eda .service-icon { background-color: #2196f3; }
        .service-controller .service-icon { background-color: #9c27b0; }
        .service-gateway .service-icon { background-color: #4caf50; }
        .service-galaxy .service-icon { background-color: #ff9800; }
        .service-unknown .service-icon { background-color: #f44336; }
    </style>
</head>
<body>
    <div class="container">
        <h1>Services Overview</h1>

        <div class="navigation">
            <a href="/" class="nav-link">Dashboard</a>
            <a href="/tools" class="nav-link">All Tools</a>
            <a href="/category" class="nav-link">Categories</a>
        </div>

        <div class="summary">
            <h2>Available Services</h2>
            <p>The AAP MCP system integrates with ${services.length} different services, providing access to ${allTools.length} total tools across the Ansible Automation Platform ecosystem.</p>
        </div>

        <div class="services-grid">
            ${services.map(service => `
            <a href="/services/${service.name}" class="service-card service-${service.name}">
                <div class="service-header">
                    <div class="service-icon">
                        ${service.displayName.charAt(0)}
                    </div>
                    <h3 class="service-title">${service.displayName}</h3>
                </div>
                <p class="service-description">${service.description}</p>
                <div class="service-stats">
                    <div class="stat">
                        <div class="stat-number">${service.toolCount}</div>
                        <div class="stat-label">Tools</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${Math.round(service.totalSize / 1000)}K</div>
                        <div class="stat-label">Characters</div>
                    </div>
                </div>
            </a>
            `).join('')}
        </div>
    </div>
</body>
</html>`;
};

export const renderServiceTools = (data: ServiceToolsData): string => {
  const { serviceName, displayName, serviceTools, totalSize, methods } = data;

  const toolRows = serviceTools.map(tool => `
    <tr>
      <td><a href="/tools/${encodeURIComponent(tool.name)}" style="color: #007acc; text-decoration: none;">${tool.name}</a></td>
      <td>${tool.size}</td>
      <td><span class="method-${tool.method.toLowerCase()}">${tool.method}</span></td>
    </tr>
  `).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${displayName} Service - AAP MCP</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 20px;
            background-color: #f5f5f5;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
            background-color: white;
            padding: 20px;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333;
            border-bottom: 2px solid #007acc;
            padding-bottom: 10px;
        }
        .service-badge {
            display: inline-block;
            background-color: #007acc;
            color: white;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 0.9em;
            margin-left: 10px;
        }
        .navigation {
            margin-bottom: 30px;
        }
        .nav-link {
            background-color: #6c757d;
            color: white;
            padding: 6px 12px;
            text-decoration: none;
            border-radius: 4px;
            margin-right: 10px;
            font-size: 0.9em;
        }
        .nav-link:hover {
            background-color: #5a6268;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
        }
        th, td {
            border: 1px solid #ddd;
            padding: 8px;
            text-align: left;
        }
        th {
            background-color: #007acc;
            color: white;
            font-weight: bold;
        }
        tr:nth-child(even) {
            background-color: #f2f2f2;
        }
        tr:hover {
            background-color: #e6f3ff;
        }
        .method-get { background-color: #28a745; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; }
        .method-post { background-color: #007bff; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; }
        .method-put { background-color: #ffc107; color: black; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; }
        .method-patch { background-color: #6f42c1; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; }
        .method-delete { background-color: #dc3545; color: white; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; }
        .stats {
            background-color: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>${displayName} Service<span class="service-badge">${serviceTools.length} tools</span></h1>

        <div class="navigation">
            <a href="/" class="nav-link">Dashboard</a>
            <a href="/services" class="nav-link">All Services</a>
            <a href="/tools" class="nav-link">All Tools</a>
            <a href="/category" class="nav-link">Categories</a>
        </div>

        <div class="stats">
            <strong>Service:</strong> ${displayName}<br>
            <strong>Total Tools:</strong> ${serviceTools.length}<br>
            <strong>Total Size:</strong> ${totalSize.toLocaleString()} characters<br>
            <strong>HTTP Methods:</strong> ${methods.join(', ')}
        </div>

        <table>
            <thead>
                <tr>
                    <th>Tool Name</th>
                    <th>Size (chars)</th>
                    <th>HTTP Method</th>
                </tr>
            </thead>
            <tbody>
                ${toolRows}
            </tbody>
        </table>
    </div>
</body>
</html>`;
};

export type { ServiceData, ServicesOverviewData, ServiceToolsData };