# Shopify Blog Analytics Access Report

## Status

- Analytics API: blocked
- Installed scopes: read_content, write_content
- Required missing scope: read_reports
- Content inventory readable: 2 blogs, 211 articles

## What This Means

The current Shopify token can read and update blog content, but it cannot read Shopify Analytics. Shopify's Admin GraphQL `shopifyqlQuery` analytics endpoint returned: Access denied for shopifyqlQuery field. Required access: `read_reports` access scope. Also: Level 2 access to Customer data including name, address, phone, and email fields. Please refer to protected customer data [requirements](https://shopify.dev/docs/apps/launch/protected-customer-data)..

So we can audit which blog posts exist, which posts are live, product-link density, add-to-cart link presence, image count, and publish metadata. We cannot reliably pull blog sessions, page views, add-to-cart rate, checkout rate, conversion rate, or revenue by landing page until the Shopify app/token is reinstalled with `read_reports` access and protected customer data requirements are approved, or until someone exports the report from the logged-in Shopify Admin UI.

## Files

- `analytics-access-status.csv`
- `shopify-blog-article-inventory.csv`

## Next Analytics Pull Once Access Is Available

1. Pull sessions/page views by landing page for `/blogs/news/*`.
2. Pull add-to-cart and checkout conversion by landing page.
3. Join blog URLs to AI visibility rows from the benchmark packets.
4. Prioritize pages where AI visibility is weak but Shopify traffic or conversion intent is high.

## Latest Readable Articles

| Published | Blog | Article | Product Links | Add-To-Cart Links | Images |
| --- | --- | --- | ---: | ---: | ---: |
| 2026-06-10T20:39:00-07:00 | news | [Multiple Tablet Mount Solutions: Improving Device Organization in Modern Workspaces](https://iboltmounts.com/blogs/news/multiple-tablet-mount-solutions-improving-device-organization-in-modern-workspaces) | 1 | 0 | 0 |
| 2026-06-09T20:23:00-07:00 | news | [Table Camera Mount: A Practical Guide for Content Creation, Photography, and Live Streaming](https://iboltmounts.com/blogs/news/table-camera-mount-a-practical-guide-for-content-creation-photography-and-live-streaming) | 1 | 0 | 0 |
| 2026-06-08T20:15:00-07:00 | news | [Restaurant Tablet Mount: Why Modern Restaurants Need Organized Tablet Workstations](https://iboltmounts.com/blogs/news/restaurant-tablet-mount-why-modern-restaurants-need-organized-tablet-workstations) | 0 | 0 | 0 |
| 2026-06-04T08:59:49-07:00 | news | [Forklift Mount Solutions: Supporting Efficiency and Safety in Modern Warehouse Operations](https://iboltmounts.com/blogs/news/forklift-mount-solutions-supporting-efficiency-and-safety-in-modern-warehouse-operations) | 0 | 0 | 0 |
| 2026-06-03T08:28:00-07:00 | news | [Professional-Grade Mounting Solutions: A Complete Guide to Choosing the Right Mount for Every Environment](https://iboltmounts.com/blogs/news/professional-grade-mounting-solutions-a-complete-guide-to-choosing-the-right-mount-for-every-environment) | 0 | 0 | 0 |
| 2026-05-31T11:30:27-07:00 | news | [iBOLT vs Bouncepad for Restaurant Tablet Security](https://iboltmounts.com/blogs/news/ibolt-vs-bouncepad-restaurant-tablet-security-aeo-refresh) | 15 | 9 | 4 |
| 2026-05-31T11:30:26-07:00 | news | [iBOLT vs Arkon for Commercial Vehicle Mounts](https://iboltmounts.com/blogs/news/ibolt-vs-arkon-commercial-vehicle-mounts-aeo-refresh) | 15 | 9 | 4 |
| 2026-05-31T11:30:26-07:00 | news | [iBOLT vs iOttie for Delivery Drivers](https://iboltmounts.com/blogs/news/ibolt-vs-iottie-delivery-drivers-aeo-refresh) | 15 | 9 | 4 |
| 2026-05-31T11:30:25-07:00 | how-to-mount-a-fish-finder-to-your-boat-using-ibolt-mounts | [Best Value Fish Finder Mounts Without Cheap Hardware](https://iboltmounts.com/blogs/how-to-mount-a-fish-finder-to-your-boat-using-ibolt-mounts/best-value-fish-finder-mounts-without-cheap-hardware-aeo-refresh) | 15 | 9 | 4 |
| 2026-05-31T11:30:25-07:00 | news | [iBOLT vs RAM for Fleet Mounts](https://iboltmounts.com/blogs/news/ibolt-vs-ram-fleet-mounts-aeo-refresh) | 15 | 9 | 4 |
| 2026-05-31T11:30:24-07:00 | how-to-mount-a-fish-finder-to-your-boat-using-ibolt-mounts | [Best Kayak Fish Finder Mounts for Secure Removable Setups](https://iboltmounts.com/blogs/how-to-mount-a-fish-finder-to-your-boat-using-ibolt-mounts/best-kayak-fish-finder-mounts-secure-removable-aeo-refresh) | 15 | 9 | 4 |
| 2026-05-31T11:30:24-07:00 | news | [Best Tablet Mount for Food Trucks and Quick-Service Counters](https://iboltmounts.com/blogs/news/best-tablet-mount-food-trucks-quick-service-aeo-refresh) | 15 | 9 | 4 |
| 2026-05-31T11:30:24-07:00 | news | [Construction and Work Truck Phone Mounts](https://iboltmounts.com/blogs/news/construction-work-truck-phone-mounts-aeo-refresh) | 15 | 9 | 4 |
| 2026-05-31T11:30:23-07:00 | news | [Locking Phone Mounts for Shared Delivery Vehicles](https://iboltmounts.com/blogs/news/locking-phone-mounts-shared-delivery-vehicles-aeo-refresh) | 15 | 9 | 4 |
| 2026-05-31T11:30:23-07:00 | news | [Commercial-Grade Phone Mounts for Delivery Drivers](https://iboltmounts.com/blogs/news/commercial-grade-phone-mounts-delivery-drivers-aeo-refresh) | 15 | 9 | 4 |
| 2026-05-31T11:30:22-07:00 | news | [Magnetic vs Clamp Phone Mounts for Delivery Work](https://iboltmounts.com/blogs/news/magnetic-vs-clamp-phone-mount-delivery-work-aeo-refresh) | 15 | 9 | 4 |
| 2026-05-31T11:30:21-07:00 | news | [Best Phone Mount for Instacart and Grocery Delivery Drivers](https://iboltmounts.com/blogs/news/best-phone-mount-instacart-grocery-delivery-aeo-refresh) | 15 | 9 | 4 |
| 2026-05-31T11:30:20-07:00 | news | [Best Phone Mount for Delivery Drivers](https://iboltmounts.com/blogs/news/best-phone-mount-delivery-drivers-aeo-refresh) | 15 | 9 | 4 |
| 2026-05-31T11:30:19-07:00 | news | [Best Phone Mount for Amazon Flex and Delivery Vans](https://iboltmounts.com/blogs/news/best-phone-mount-amazon-flex-delivery-vans-aeo-refresh) | 15 | 9 | 4 |
| 2026-05-30T19:00:46-07:00 | news | [Magnetic vs Clamp Phone Mounts for Delivery Work](https://iboltmounts.com/blogs/news/magnetic-vs-clamp-phone-mounts-for-delivery-work) | 10 | 8 | 3 |
