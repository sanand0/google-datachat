export const schema = `
CREATE TABLE users (id INT PRIMARY KEY, first_name STRING, last_name STRING, email STRING, age INT, gender STRING, state STRING, street_address STRING, postal_code STRING, city STRING, country STRING, latitude FLOAT, longitude FLOAT, traffic_source STRING, created_at TIMESTAMP, user_geom GEOGRAPHY);
CREATE TABLE distribution_centers (id INT PRIMARY KEY, name STRING, latitude FLOAT, longitude FLOAT, distribution_center_geom GEOGRAPHY);
CREATE TABLE products (id INT PRIMARY KEY, cost FLOAT, category STRING, name STRING, brand STRING, retail_price FLOAT, department STRING, sku STRING, distribution_center_id INT, FOREIGN KEY (distribution_center_id) REFERENCES distribution_centers(id));
CREATE TABLE inventory_items (id INT PRIMARY KEY, product_id INT, created_at TIMESTAMP, sold_at TIMESTAMP, cost FLOAT, product_category STRING, product_name STRING, product_brand STRING, product_retail_price FLOAT, product_department STRING, product_sku STRING, product_distribution_center_id INT, FOREIGN KEY (product_id) REFERENCES products(id), FOREIGN KEY (product_distribution_center_id) REFERENCES distribution_centers(id));
CREATE TABLE orders (order_id INT PRIMARY KEY, user_id INT, status STRING, gender STRING, created_at TIMESTAMP, returned_at TIMESTAMP, shipped_at TIMESTAMP, delivered_at TIMESTAMP, num_of_item INT, FOREIGN KEY (user_id) REFERENCES users(id));
CREATE TABLE order_items (id INT PRIMARY KEY, order_id INT, user_id INT, product_id INT, inventory_item_id INT, status STRING, created_at TIMESTAMP, shipped_at TIMESTAMP, delivered_at TIMESTAMP, returned_at TIMESTAMP, sale_price FLOAT, FOREIGN KEY (order_id) REFERENCES orders(id), FOREIGN KEY (user_id) REFERENCES users(id), FOREIGN KEY (product_id) REFERENCES products(id), FOREIGN KEY (inventory_item_id) REFERENCES inventory_items(id));
CREATE TABLE events (id INT PRIMARY KEY, user_id INT, sequence_number INT, session_id STRING, created_at TIMESTAMP, ip_address STRING, city STRING, state STRING, postal_code STRING, browser STRING, traffic_source STRING, uri STRING, event_type STRING, FOREIGN KEY (user_id) REFERENCES users(id));

order_items.status: Cancelled, Complete, Processing, Returned, and Shipped
`;

export const questions = [
  "What are our top three products by revenue in each region for the last quarter, and how does that compare to the same quarter last year?",
  "Which suppliers deliver the highest average profit margin per order line?",
  "Which customers last ordered more than 12 months ago but previously accounted for over 75% of their total spend?",
  "How many orders each month had discounts exceeding 10% and were shipped more than seven days late?",
  "Which customer segments saw monthly order volume growth exceeding 20% compared to their three-month average?",
  "Which products have demand exceeding available inventory by more than 50%?",
  "Who are our top 10% customers by lifetime spend, and what percentage of their orders included discounts above 5%?",
  "What is each supplier’s average shipping delay and supply cost, and is there a correlation?",
];

export const intentPrompt = `Respond to the user message.

If the question can be answered by the "TheLook Ecommerce Dataset", then:

1. Briefly guess the user's intent
2. Write a SINGLE BigQuery SQL query to answer, wrapped in \`\`\`sql...\`\`\`
3. Limit the response to at most 1,000 rows. Prefer aggregates over raw data.

Use this schema:

${schema}

If the question can't be answered by querying this dataset, tell the user you are a data chatbot that can answer questions from the data above and suggest relevant sample questions.
`;

export const answerPrompt = (data, userMessage) => `Answer the question using the provided data:

${data}

Question: ${userMessage}

Note: today is ${new Date().toISOString()}
`;

export const query = async (apiToken, sql) => {
  const response = await fetch("https://bigquery.googleapis.com/bigquery/v2/projects/straive-datachat/queries", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      query: sql,
      defaultDataset: {
        projectId: "bigquery-public-data",
        datasetId: "thelook_ecommerce",
      },
      useLegacySql: false,
    }),
  });

  const res = await response.json();
  let records = [];
  if (res.schema && res.rows) {
    const fields = res.schema.fields.map((f) => f.name);
    records = res.rows.map((r) => Object.fromEntries(r.f.map((cell, i) => [fields[i], cell.v])));
  }
  return records;
};
