export default {
  async fetch(request) {
    console.log("[DEBUG] Received:", request.url);

    return new Response("OK", {
      status: 200,
      headers: {
        "Content-Type": "text/plain"
      }
    });
  }
};
