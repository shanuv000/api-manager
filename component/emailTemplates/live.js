function generateEmailTemplate(matches) {
  let emailContent = `
    <div style="font-family: Arial, sans-serif; color: #333; padding: 10px; text-align: center;">
      <h1 style="color: #4CAF50; text-align: center; background-color: #f1f1f1; padding: 20px; border-radius: 10px;">Live Cricket Scores</h1>
      <ul style="list-style-type: none; padding: 0; margin: 20px 0;">
  `;

  matches.forEach((match) => {
    emailContent += `
      <li style="margin-bottom: 20px; padding: 20px; border: 1px solid #ddd; border-radius: 10px; background-color: #f9f9f9; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);">
        <h1 style="color: #2196F3; margin-bottom: 10px;">${match.title}</h1><h2 style="color: #FF0000; text-align: center; font-size: 30px;">${match.playingTeamBat}: ${match.liveScorebat}, ${match.playingTeamBall}: ${match.liveScoreball}</h2>
        <h3 style="color: #006A4E; margin-bottom: 10px;">${match.heading}</h3>
        <p><strong>Details:</strong> ${match.matchDetails}</p>
        <p><strong>Location:</strong> ${match.location}</p>
        <p><strong>Teams:</strong> ${match.playingTeamBat} vs ${match.playingTeamBall}</p>
        <br/>
        <h1 style="color: #FF5722; text-align: center; font-size: 24px; margin: 20px 0;">Live Score</h1>
        
        <p><strong>Commentary:</strong> ${match.liveCommentary}</p>
        <div style="margin-top: 20px; text-align: center;">
          <a href="${match.links["Live Score"]}" style="text-decoration: none; color: #fff; background-color: #4CAF50; padding: 10px 15px; border-radius: 5px; display: inline-block; margin: 5px 0;">Live Score</a>
          <a href="${match.links.Scorecard}" style="text-decoration: none; color: #fff; background-color: #2196F3; padding: 10px 15px; border-radius: 5px; display: inline-block; margin: 5px 0;">Scorecard</a>
          <a href="${match.links["Full Commentary"]}" style="text-decoration: none; color: #fff; background-color: #FF5722; padding: 10px 15px; border-radius: 5px; display: inline-block; margin: 5px 0;">Full Commentary</a>
          <a href="${match.links.News}" style="text-decoration: none; color: #fff; background-color: #795548; padding: 10px 15px; border-radius: 5px; display: inline-block; margin: 5px 0;">News</a>
        </div>
      </li>
    `;
  });

  emailContent += `
      </ul>
    </div>
  `;

  return emailContent;
}

module.exports = generateEmailTemplate;
