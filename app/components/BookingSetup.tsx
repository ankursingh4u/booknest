import { BlockStack, Box, Card, List, Text } from "@shopify/polaris";
export function BookingSetup() {
  return <Card><Box padding="400"><BlockStack gap="400">
    <Text as="h2" variant="headingMd">Set up your booking calendar</Text>
    <Text as="p">Create Events/Services and assign Availabilities so customers can book a time that works.</Text>
    <List type="number">
      <List.Item>Add a location and choose its timezone.</List.Item>
      <List.Item>Add Availabilities and their working hours.</List.Item>
      <List.Item>Create Events/Services and connect them to Shopify products.</List.Item>
    </List>
  </BlockStack></Box></Card>;
}
